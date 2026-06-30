import type { UUID } from "./common.js";

/** PRD §3.1 — User / Role */
export type Role = "OWNER" | "CREATOR" | "BUYER" | "ADMIN";

export type KycStatus = "none" | "verified";

export interface User {
  user_id: UUID;
  role: Role;
  /** Export/settlement actors must be `verified` (PRD §3.1). */
  kyc_status: KycStatus;
  /** Drives minor protection + hard-limit application. */
  age_verified: boolean;
  /** Payout destination for creators/owners. Opaque reference. */
  payout_account?: UUID | null;
  display_name?: string;
}
