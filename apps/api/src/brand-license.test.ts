import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/**
 * The marketplace's third side: an external brand licenses a fan/AI-made
 * creation through the same Rights Engine gate (request → owner approval →
 * settlement), which is the structural differentiator from a fan storefront.
 */
describe("Brand licensing (third side)", () => {
  let app: ReturnType<typeof buildServer>;
  let brand: string;
  let owner: string;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "password" } })).json()
        .token as string;
    brand = await login("owner@remixhub.dev"); // stands in for a brand buyer
    owner = await login("gd@remixhub.dev"); // GD studio owns ip_gd
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists shared creations open for commercial licensing", async () => {
    const res = await app.inject({ method: "GET", url: "/license/catalog" });
    expect(res.statusCode).toBe(200);
    const catalog = res.json().catalog as { creation_id: string; commercial_allowed: boolean; indicative_fee: number | null }[];
    // The GD sample seeds shared creations under an official IP that allows commercial use.
    const gd = catalog.find((c) => c.creation_id === "cr_gd_couture");
    expect(gd).toBeTruthy();
    expect(gd!.commercial_allowed).toBe(true);
    expect(gd!.indicative_fee).toBeGreaterThan(0);
  });

  it("routes a brand request into the owner's queue, then settles", async () => {
    const reqRes = await app.inject({
      method: "POST",
      url: "/generations/cr_gd_couture/license-request",
      headers: bearer(brand),
      payload: { brand: "NOVA Cosmetics", use_case: "봄 캠페인 키비주얼" },
    });
    expect(reqRes.statusCode).toBe(201);
    const exp = reqRes.json().export;
    expect(exp.use_type).toBe("commercial");
    expect(exp.brand).toBe("NOVA Cosmetics");
    expect(exp.use_case).toBe("봄 캠페인 키비주얼");

    // Commercial use requires the IP owner's approval before it can settle.
    if (exp.approval === "pending") {
      const dec = await app.inject({
        method: "POST",
        url: `/exports/${exp.export_id}/approve`,
        headers: bearer(owner),
        payload: { approve: true },
      });
      expect(dec.statusCode).toBe(200);
    }
    const pay = await app.inject({
      method: "POST",
      url: `/exports/${exp.export_id}/pay`,
      headers: bearer(owner),
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().distribution.owner).toBeGreaterThan(0);
  });

  it("rejects a license request without a brand name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/generations/cr_gd_couture/license-request",
      headers: bearer(brand),
      payload: { use_case: "no brand" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("brand_required");
  });
});
