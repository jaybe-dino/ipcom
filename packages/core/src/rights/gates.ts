import type { Money } from "../types/common.js";
import type { CreativeAction, IP, RevenueSplit, UseType } from "../types/consent.js";
import type { ModerationResult } from "../types/creation.js";
import { priceFor, type PricingContext } from "./pricing.js";

/**
 * Rights Engine — the three gates (PRD §4.3).
 *
 *   G1 생성     : Consent.allowed_actions + Moderation  → allow / deny
 *   G2 내부공유 : always allowed for space members      → free share
 *   G3 외부반출 : Consent.export_policy + use_type       → auto/review/deny + fee
 *
 * Monetization triggers on DISTRIBUTION (G3), never on generation (G1/G2).
 */

export type GateDecision = "ALLOW" | "DENY";

export interface GenerateVerdict {
  decision: GateDecision;
  /** Machine-readable reason when denied: "hard_limit" | "not_allowed". */
  reason?: "hard_limit" | "not_allowed";
}

/** G1 — may this action be generated for this IP given moderation? */
export function canGenerate(
  ip: IP,
  action: CreativeAction,
  moderation: ModerationResult,
): GenerateVerdict {
  // Hard limits override IP consent entirely (legal absolute, PRD §4.4).
  if (!moderation.passed) {
    return { decision: "DENY", reason: "hard_limit" };
  }
  if (!ip.policy.allowed_actions[action]) {
    return { decision: "DENY", reason: "not_allowed" };
  }
  return { decision: "ALLOW" };
}

/**
 * G2 — internal share. Always free for space members. Membership itself is
 * checked by the Community Service; the gate is a no-op affirmation here.
 */
export function canShareInternally(): { decision: GateDecision } {
  return { decision: "ALLOW" };
}

export type ExportOutcome = "auto" | "review" | "deny";

export interface ExportVerdict {
  outcome: ExportOutcome;
  /** Computed fee (0 when denied). */
  fee: Money;
  /** Split snapshot to persist for settlement; null when denied. */
  split: RevenueSplit | null;
  /** Whether a human-visible AI label is mandatory for this export. */
  visible_label: boolean;
}

/** G3 — external export decision + fee + split snapshot. */
export function exportDecision(
  ip: IP,
  useType: UseType,
  ctx: PricingContext = {},
): ExportVerdict {
  const policy = ip.policy.export_policy[useType];
  if (policy === "deny") {
    return { outcome: "deny", fee: 0, split: null, visible_label: true };
  }
  const fee = priceFor(ip, useType, ctx);
  const split = ip.policy.revenue_split[useType];
  return {
    outcome: policy, // "auto" | "review"
    fee,
    split,
    // External exports always carry a visible "AI generated" label (PRD §7.3).
    visible_label: true,
  };
}
