import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/** Marketplace flow: create → list → buy → order + license + settlement. */
describe("Marketplace", () => {
  let app: ReturnType<typeof buildServer>;
  let creatorToken: string;
  let ownerToken: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    const login = async (email: string) =>
      (
        await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "password" } })
      ).json().token as string;
    creatorToken = await login("minji@remixhub.dev");
    ownerToken = await login("owner@remixhub.dev");
  });
  afterAll(async () => {
    await app.close();
  });

  async function makeCreation(): Promise<string> {
    const gen = await app.inject({
      method: "POST",
      url: "/spaces/space_artist_g/generations",
      headers: bearer(creatorToken),
      payload: { action: "image", prompt: "market piece" },
    });
    return gen.json().creation.creation_id;
  }

  it("lists a creation and a buyer purchases it with a sale split", async () => {
    const creationId = await makeCreation();
    const listed = await app.inject({
      method: "POST",
      url: "/market/listings",
      headers: bearer(creatorToken),
      payload: { kind: "creation", ref_id: creationId, title: "Neon Piece", price: 100_000 },
    });
    expect(listed.statusCode).toBe(201);
    const listingId = listed.json().listing.listing_id;

    const catalog = await app.inject({ method: "GET", url: "/market/listings" });
    expect(catalog.json().listings.some((l: { listing_id: string }) => l.listing_id === listingId)).toBe(true);

    // Owner buys it.
    const order = await app.inject({
      method: "POST",
      url: `/market/listings/${listingId}/buy`,
      headers: bearer(ownerToken),
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().order.distribution).toEqual({ owner: 40_000, creator: 40_000, platform: 20_000 });
    expect(order.json().order.license_doc).toBeTruthy();
  });

  it("rejects buying your own listing", async () => {
    const creationId = await makeCreation();
    const listed = await app.inject({
      method: "POST",
      url: "/market/listings",
      headers: bearer(creatorToken),
      payload: { kind: "creation", ref_id: creationId, title: "Mine", price: 5000 },
    });
    const listingId = listed.json().listing.listing_id;
    const res = await app.inject({
      method: "POST",
      url: `/market/listings/${listingId}/buy`,
      headers: bearer(creatorToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it("sells a prompt template with the platform take rate", async () => {
    const tpl = await app.inject({
      method: "POST",
      url: "/market/templates",
      headers: bearer(creatorToken),
      payload: { title: "Cyberpunk preset", body: "neon, rain, cinematic" },
    });
    const templateId = tpl.json().template.template_id;
    const listed = await app.inject({
      method: "POST",
      url: "/market/listings",
      headers: bearer(creatorToken),
      payload: { kind: "template", ref_id: templateId, title: "Cyberpunk preset", price: 10_000 },
    });
    const order = await app.inject({
      method: "POST",
      url: `/market/listings/${listed.json().listing.listing_id}/buy`,
      headers: bearer(ownerToken),
    });
    expect(order.json().order.distribution).toEqual({ owner: 0, creator: 8_000, platform: 2_000 });
  });

  it("applies a promo coupon at checkout: discounted charge + recomputed split", async () => {
    // Admin creates a 20%-off code.
    const created = await app.inject({
      method: "POST",
      url: "/market/coupons",
      headers: bearer(ownerToken),
      payload: { code: "spring20", kind: "percent", value: 0.2, max_redemptions: 3 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().coupon.code).toBe("SPRING20");

    const creationId = await makeCreation();
    const listed = await app.inject({
      method: "POST",
      url: "/market/listings",
      headers: bearer(creatorToken),
      payload: { kind: "creation", ref_id: creationId, title: "Coupon Piece", price: 100_000 },
    });
    const listingId = listed.json().listing.listing_id;

    // Buyer applies the code (case-insensitive). 100k → 80k, split over 80k.
    const order = await app.inject({
      method: "POST",
      url: `/market/listings/${listingId}/buy`,
      headers: bearer(ownerToken),
      payload: { coupon_code: "spring20" },
    });
    expect(order.statusCode).toBe(201);
    const o = order.json().order;
    expect(o.amount).toBe(80_000);
    expect(o.discount).toBe(20_000);
    expect(o.coupon_code).toBe("SPRING20");
    expect(o.distribution).toEqual({ owner: 32_000, creator: 32_000, platform: 16_000 });

    // An unknown code is rejected.
    const bad = await app.inject({
      method: "POST",
      url: `/market/listings/${listingId}/buy`,
      headers: bearer(ownerToken),
      payload: { coupon_code: "NOPE" },
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error).toBe("coupon_not_found");
  });

  it("keeps the ledger intact after marketplace settlements", async () => {
    const res = await app.inject({ method: "GET", url: "/ledger" });
    expect(res.json().integrity_ok).toBe(true);
  });

  it("exports the ledger and settlement trend as downloadable CSV", async () => {
    const led = await app.inject({ method: "GET", url: "/ledger.csv" });
    expect(led.statusCode).toBe(200);
    expect(led.headers["content-type"]).toContain("text/csv");
    expect(led.headers["content-disposition"]).toContain("attachment");
    const lines = led.body.trim().split("\r\n");
    expect(lines[0]).toContain("index,event_type,actor"); // header (after BOM)
    expect(lines.length).toBeGreaterThan(1);

    const sum = await app.inject({ method: "GET", url: "/settlement/summary.csv?days=7" });
    expect(sum.statusCode).toBe(200);
    expect(sum.body).toContain("date,fees,owner");
  });

  it("buyer portal lists my purchases and serves my license, but not others'", async () => {
    // The owner has bought at least one listing in earlier tests.
    const mine = await app.inject({ method: "GET", url: "/me/orders", headers: bearer(ownerToken) });
    expect(mine.statusCode).toBe(200);
    const orders = mine.json().orders as { order_id: string; buyer_id: string; listing_title: string; license_doc?: string }[];
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.every((o) => o.buyer_id === "user_owner_g")).toBe(true);
    expect(orders[0]!.listing_title).toBeTruthy();

    const withLicense = orders.find((o) => o.license_doc);
    expect(withLicense).toBeTruthy();
    const lic = await app.inject({
      method: "GET",
      url: `/me/orders/${withLicense!.order_id}/license`,
      headers: bearer(ownerToken),
    });
    expect(lic.statusCode).toBe(200);
    expect(lic.json().license).toBeTruthy();

    // A different user cannot download someone else's license.
    const forbidden = await app.inject({
      method: "GET",
      url: `/me/orders/${withLicense!.order_id}/license`,
      headers: bearer(creatorToken),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("seller portal reports the creator's sales and earnings", async () => {
    // minji (creator) listed and sold pieces to the owner in earlier tests.
    const res = await app.inject({ method: "GET", url: "/me/sales", headers: bearer(creatorToken) });
    expect(res.statusCode).toBe(200);
    const { sales, totals } = res.json() as {
      sales: { seller_id: string }[];
      totals: { count: number; gross: number; earned: number; platform_fees: number };
    };
    expect(sales.length).toBeGreaterThanOrEqual(1);
    expect(sales.every((s) => s.seller_id === "user_minji")).toBe(true);
    expect(totals.count).toBe(sales.length);
    // Earnings + platform fees reconcile to the gross transaction volume.
    expect(totals.earned + totals.platform_fees).toBe(totals.gross);
  });
});
