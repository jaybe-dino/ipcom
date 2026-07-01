import type { ISODateTime, UUID } from "./common.js";

/** In-app notifications for community activity. */
export type NotificationType = "mention" | "reply" | "dm";

export interface Notification {
  notification_id: UUID;
  /** Recipient. */
  user_id: UUID;
  type: NotificationType;
  /** Who triggered it. */
  actor_id: UUID;
  channel_id: UUID;
  post_id: UUID;
  /** Short preview of the message. */
  text: string;
  read: boolean;
  created_at: ISODateTime;
}
