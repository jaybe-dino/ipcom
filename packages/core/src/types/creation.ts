import type { ISODateTime, Money, UUID } from "./common.js";
import type { CreativeAction, UseType } from "./consent.js";

/** PRD §3.4 — Creation (생성물) */

export type CreationStatus =
  | "generated"
  | "shared"
  | "export_requested"
  | "exported"
  | "blocked";

/** Moderation result attached to a creation / generation request (PRD §4.4). */
export interface ModerationResult {
  passed: boolean;
  /** Per-category confidence score in [0,1]; key is a HardLimitCategory. */
  scores: Record<string, number>;
  /** If blocked, the categories that tripped the limit. */
  flagged: string[];
}

/** Provenance hook output every plugin must provide (PRD §5.1). */
export interface Provenance {
  source_assets: string[];
  model_info: { plugin_id: string; model?: string; version?: string };
  prompt: string;
}

export interface Creation {
  creation_id: UUID;
  ip_id: UUID;
  creator_id: UUID;
  plugin_id: string;
  action: CreativeAction;
  prompt_ref?: UUID | null;
  source_assets: string[];
  /** Internal-use output asset (carries watermark metadata). */
  output_asset?: string | null;
  moderation: ModerationResult;
  provenance?: Provenance;
  status: CreationStatus;
  created_at: ISODateTime;
}

/** PRD §3.5 — ExportRequest & License */

export type Approval = "auto" | "pending" | "approved" | "rejected";

export interface ExportRequest {
  export_id: UUID;
  creation_id: UUID;
  requester_id: UUID;
  use_type: UseType;
  approval: Approval;
  fee_amount: Money;
  /** Revenue split snapshot taken at decision time (immutable basis for settlement). */
  split_snapshot: { owner: number; creator: number; platform: number };
  license_doc?: UUID | null;
  /** Whether a human-visible "AI generated" label is required/attached. */
  visible_label: boolean;
  created_at: ISODateTime;
  decided_at?: ISODateTime | null;
  /** Reason set when approval === "rejected". */
  reject_reason?: string | null;
}
