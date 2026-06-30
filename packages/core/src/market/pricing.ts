import { distribute, type Distribution } from "../rights/pricing.js";
import type { Money } from "../types/common.js";
import type { RevenueSplit } from "../types/consent.js";

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
