import type { ISODateTime, UUID } from "./common.js";

/**
 * Post-hoc moderation (PRD §4.4): user reports + a human-review queue that
 * complements the pre-generation Hard Limit screen.
 */
export type ReportTargetType = "creation" | "post" | "space";

export type ReportStatus = "open" | "actioned" | "dismissed";

export interface Report {
  report_id: UUID;
  target_type: ReportTargetType;
  target_id: UUID;
  reporter_id: UUID;
  reason: string;
  status: ReportStatus;
  created_at: ISODateTime;
  resolved_at?: ISODateTime | null;
  resolver_id?: UUID | null;
  note?: string | null;
}
