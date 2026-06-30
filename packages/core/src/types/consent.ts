import type { UUID } from "./common.js";

/**
 * PRD §3.2 / §4.1 — IP & ConsentPolicy (the "Consent Matrix").
 * The IP owner is the single source of truth for what is allowed,
 * how it may leave the community, and how revenue is split.
 */

/** Creative actions a plugin can perform. Each is toggled ON/OFF per IP. */
export type CreativeAction =
  | "image" // 이미지 생성
  | "video_recast" // 영상 출연자 교체
  | "voice" // 음성 합성
  | "music" // 음악·음원 생성
  | "characterize"; // 2차 캐릭터화

export const CREATIVE_ACTIONS: readonly CreativeAction[] = [
  "image",
  "video_recast",
  "voice",
  "music",
  "characterize",
] as const;

/**
 * Platform-enforced absolute prohibitions. These are ALWAYS blocked regardless
 * of IP consent and cannot be toggled off (PRD §4.4, legal §7.2).
 */
export type HardLimitCategory =
  | "sexual" // 성적 맥락
  | "defamation" // 허위사실·명예훼손
  | "harassment" // 협박·괴롭힘
  | "political_abuse"; // 정치적 악용

export const HARD_LIMIT_CATEGORIES: readonly HardLimitCategory[] = [
  "sexual",
  "defamation",
  "harassment",
  "political_abuse",
] as const;

/** Export use types (PRD §3.5 / §5.3). */
export type UseType = "personal" | "commercial" | "sale";

export const USE_TYPES: readonly UseType[] = ["personal", "commercial", "sale"] as const;

/** Per-use-type approval policy chosen by the IP owner (PRD §5.2). */
export type ExportPolicy = "auto" | "review" | "deny";

/** Revenue split for a given use type. Fractions must sum to 1.0. */
export interface RevenueSplit {
  /** IP owner share (0..1). */
  owner: number;
  /** Creator share (0..1). */
  creator: number;
  /** Platform take (0..1). */
  platform: number;
}

export type Verification = "unverified" | "official";

export interface ConsentPolicy {
  /** Item-by-item ON/OFF for creative actions. */
  allowed_actions: Record<CreativeAction, boolean>;
  /** Read-only platform hard limits (always enforced). Present for transparency. */
  hard_limits: Record<HardLimitCategory, true>;
  /** auto / review / deny per use type. */
  export_policy: Record<UseType, ExportPolicy>;
  /** Revenue split per use type (snapshotted at approval time). */
  revenue_split: Record<UseType, RevenueSplit>;
  /** Monotonic version; bumped on every edit (PRD §4.1). */
  version: number;
}

export interface IP {
  ip_id: UUID;
  owner_id: UUID;
  name: string;
  verification: Verification;
  policy: ConsentPolicy;
}
