import {
  CREATIVE_ACTIONS,
  HARD_LIMIT_CATEGORIES,
  USE_TYPES,
  type ConsentPolicy,
  type CreativeAction,
  type ExportPolicy,
  type HardLimitCategory,
  type RevenueSplit,
  type UseType,
} from "../types/consent.js";

/** Hard limits are always present and always true (read-only). */
export function hardLimits(): Record<HardLimitCategory, true> {
  return Object.fromEntries(HARD_LIMIT_CATEGORIES.map((c) => [c, true])) as Record<
    HardLimitCategory,
    true
  >;
}

/**
 * Default revenue splits (PRD §6.2 example model).
 * - sale: creation labor weighted → owner/creator balanced.
 * - commercial: IP value weighted → owner-heavy.
 * - personal: micro-fee, no owner cut in the mockup example.
 */
const DEFAULT_SPLITS: Record<UseType, RevenueSplit> = {
  sale: { owner: 0.4, creator: 0.4, platform: 0.2 },
  commercial: { owner: 0.6, creator: 0.25, platform: 0.15 },
  personal: { owner: 0, creator: 0.7, platform: 0.3 },
};

const DEFAULT_EXPORT_POLICY: Record<UseType, ExportPolicy> = {
  personal: "auto",
  commercial: "review",
  sale: "review",
};

export interface ConsentPolicyOverrides {
  allowed_actions?: Partial<Record<CreativeAction, boolean>>;
  export_policy?: Partial<Record<UseType, ExportPolicy>>;
  revenue_split?: Partial<Record<UseType, RevenueSplit>>;
}

/**
 * Build a conservative default Consent Policy. By design the safest default is
 * to enable common image/video actions but leave voice OFF (higher legal risk),
 * matching the mockup's IP-owner screen.
 */
export function defaultConsentPolicy(overrides: ConsentPolicyOverrides = {}): ConsentPolicy {
  const allowed = Object.fromEntries(
    CREATIVE_ACTIONS.map((a) => [a, a !== "voice"]),
  ) as Record<CreativeAction, boolean>;

  return {
    allowed_actions: { ...allowed, ...overrides.allowed_actions },
    hard_limits: hardLimits(),
    export_policy: { ...DEFAULT_EXPORT_POLICY, ...overrides.export_policy },
    revenue_split: { ...DEFAULT_SPLITS, ...overrides.revenue_split },
    version: 1,
  };
}

/** Validate that every revenue split sums to ~1.0. Returns the offending use types. */
export function invalidSplits(policy: ConsentPolicy, epsilon = 1e-6): UseType[] {
  return USE_TYPES.filter((u) => {
    const s = policy.revenue_split[u];
    return Math.abs(s.owner + s.creator + s.platform - 1) > epsilon;
  });
}

/** Produce the next version of a policy, bumping the version counter. */
export function revisePolicy(
  current: ConsentPolicy,
  overrides: ConsentPolicyOverrides,
): ConsentPolicy {
  return {
    ...current,
    allowed_actions: { ...current.allowed_actions, ...overrides.allowed_actions },
    export_policy: { ...current.export_policy, ...overrides.export_policy },
    revenue_split: { ...current.revenue_split, ...overrides.revenue_split },
    // hard_limits intentionally never change.
    hard_limits: current.hard_limits,
    version: current.version + 1,
  };
}
