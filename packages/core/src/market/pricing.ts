import { distribute, type Distribution } from "../rights/pricing.js";
import type { Money } from "../types/common.js";
import type { RevenueSplit } from "../types/consent.js";
import type { Coupon } from "../types/market.js";

/**
 * Marketplace pricing (PRD §6). Creation sales reuse the IP's `sale` revenue
 * split; prompt-template sales use a flat platform take rate (the rest goes to
 * the author, treated as the creator share).
 */

export const TEMPLATE_TAKE_RATE = 0.2;

/** Distribute a creation-sale price using the IP's sale split. */
export function creationOrderDistribution(price: Money, saleSplit: RevenueSplit): Distribution {
  return distribute(price, saleSplit);
}

/** Distribute a template-sale price: platform take rate, remainder to author. */
export function templateOrderDistribution(price: Money, takeRate = TEMPLATE_TAKE_RATE): Distribution {
  return distribute(price, { owner: 0, creator: 1 - takeRate, platform: takeRate });
}

export type CouponResult =
  | { ok: true; discount: Money; final_price: Money }
  | { ok: false; reason: string };

/**
 * Validate a coupon against a listing price and compute the discount. Pure and
 * deterministic (time is injected). Discount is clamped so the final price never
 * goes below 0, and a whole KRW amount is returned (no fractional currency).
 */
export function applyCoupon(price: Money, coupon: Coupon, nowISO: string): CouponResult {
  if (!coupon.active) return { ok: false, reason: "coupon_inactive" };
  if (coupon.expires_at && new Date(nowISO).getTime() > new Date(coupon.expires_at).getTime()) {
    return { ok: false, reason: "coupon_expired" };
  }
  if (coupon.max_redemptions != null && coupon.redemptions >= coupon.max_redemptions) {
    return { ok: false, reason: "coupon_exhausted" };
  }
  if (coupon.min_price != null && price < coupon.min_price) {
    return { ok: false, reason: "below_min_price" };
  }
  const raw = coupon.kind === "percent" ? price * coupon.value : coupon.value;
  const discount = Math.min(price, Math.max(0, Math.round(raw)));
  return { ok: true, discount, final_price: price - discount };
}
