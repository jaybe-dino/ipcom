import type { Money } from "../types/common.js";
import type { IP, RevenueSplit, UseType } from "../types/consent.js";

/**
 * Fee calculation for the export gate (PRD §4.3 `pricing()`).
 *
 * The pricing model is intentionally pluggable per use type:
 * - personal:   small flat fee.
 * - commercial: base license fee (range starts here; scope/term multipliers later).
 * - sale:       a percentage of the declared sale price (revenue share).
 */
export interface PricingContext {
  /** Declared sale price; required for `sale`. */
  sale_price?: Money;
}

/** Default base amounts mirroring the mockup's gate screen. */
export const PRICING_DEFAULTS = {
  personalFlatFee: 1_000 as Money,
  commercialBaseFee: 500_000 as Money,
  /** Platform-set ceiling fraction of sale price used as the gross license fee. */
  saleGrossIsSalePrice: true,
} as const;

export function priceFor(_ip: IP, useType: UseType, ctx: PricingContext = {}): Money {
  switch (useType) {
    case "personal":
      return PRICING_DEFAULTS.personalFlatFee;
    case "commercial":
      return PRICING_DEFAULTS.commercialBaseFee;
    case "sale": {
      const price = ctx.sale_price ?? 0;
      if (price <= 0) {
        throw new Error("sale_price is required and must be positive for use_type=sale");
      }
      // For a sale, the gross amount distributed IS the sale price.
      return price;
    }
  }
}

/** Distribute a gross amount across owner/creator/platform using a split. */
export interface Distribution {
  owner: Money;
  creator: Money;
  platform: Money;
}

/**
 * Split `gross` by `split`. Uses integer minor units and assigns the rounding
 * remainder to the platform so the parts always sum exactly to `gross`.
 */
export function distribute(gross: Money, split: RevenueSplit): Distribution {
  const owner = Math.round(gross * split.owner);
  const creator = Math.round(gross * split.creator);
  const platform = gross - owner - creator;
  return { owner, creator, platform };
}
