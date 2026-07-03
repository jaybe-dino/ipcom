import type { ISODateTime, UUID } from "./common.js";

/**
 * In-app notifications. Community events (mention/reply/dm) reference a channel
 * and post; lifecycle events (export decision, settlement, license expiry) do
 * not, so those references are nullable.
 */
export type NotificationType =
  | "mention"
  | "reply"
  | "dm"
  | "export_decision"
  | "settlement"
  | "license_expiry";

export interface Notification {
  notification_id: UUID;
  /** Recipient. */
  user_id: UUID;
  type: NotificationType;
  /** Who triggered it (acting user, or the recipient for system events). */
  actor_id: UUID;
  /** Community events only; null for lifecycle notifications. */
  channel_id: UUID | null;
  post_id: UUID | null;
  /** Short preview / summary line. */
  text: string;
  read: boolean;
  created_at: ISODateTime;
}
