import { describe, expect, it } from "vitest";
import { applyCoupon, creationOrderDistribution, templateOrderDistribution } from "./pricing.js";
import type { Coupon } from "../types/market.js";

describe("marketplace pricing", () => {
  it("distributes a creation sale by the IP sale split", () => {
    const d = creationOrderDistribution(100_000, { owner: 0.4, creator: 0.4, platform: 0.2 });
    expect(d).toEqual({ owner: 40_000, creator: 40_000, platform: 20_000 });
  });

  it("applies a flat take rate to template sales (rest to author)", () => {
    const d = templateOrderDistribution(10_000);
    expect(d).toEqual({ owner: 0, creator: 8_000, platform: 2_000 });
  });

  it("always sums to the gross amount", () => {
    const d = templateOrderDistribution(9_999, 0.3);
    expect(d.owner + d.creator + d.platform).toBe(9_999);
  });
});

describe("applyCoupon", () => {
  const base: Coupon = {
    code: "WELCOME",
    kind: "percent",
    value: 0.2,
    redemptions: 0,
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const NOW = "2026-07-03T00:00:00.000Z";

  it("applies a percentage discount, rounded to whole KRW", () => {
    const r = applyCoupon(12_345, base, NOW);
    expect(r).toEqual({ ok: true, discount: 2_469, final_price: 9_876 });
  });

  it("applies a fixed discount clamped to the price", () => {
    const r = applyCoupon(3_000, { ...base, kind: "fixed", value: 5_000 }, NOW);
    expect(r).toEqual({ ok: true, discount: 3_000, final_price: 0 });
  });

  it("rejects inactive, expired, exhausted, or below-min coupons", () => {
    expect(applyCoupon(10_000, { ...base, active: false }, NOW)).toEqual({ ok: false, reason: "coupon_inactive" });
    expect(applyCoupon(10_000, { ...base, expires_at: "2026-01-02T00:00:00.000Z" }, NOW)).toEqual({
      ok: false,
      reason: "coupon_expired",
    });
    expect(applyCoupon(10_000, { ...base, max_redemptions: 5, redemptions: 5 }, NOW)).toEqual({
      ok: false,
      reason: "coupon_exhausted",
    });
    expect(applyCoupon(1_000, { ...base, min_price: 5_000 }, NOW)).toEqual({ ok: false, reason: "below_min_price" });
  });
});
