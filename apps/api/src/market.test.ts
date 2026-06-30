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

  it("keeps the ledger intact after marketplace settlements", async () => {
    const res = await app.inject({ method: "GET", url: "/ledger" });
    expect(res.json().integrity_ok).toBe(true);
  });
});
