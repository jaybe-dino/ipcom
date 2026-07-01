import type { ISODateTime, UUID } from "./common.js";

/** PRD §3.3 — Space / Channel / Post */

export type ChannelType = "creation" | "community" | "market";

export interface Space {
  space_id: UUID;
  /** A space maps to an IP (or topic). */
  ip_id: UUID;
  name: string;
  cover?: string;
  member_count: number;
  online_count: number;
}

export interface Channel {
  channel_id: UUID;
  space_id: UUID;
  name: string;
  type: ChannelType;
  /** For creation channels, which action this channel is oriented around. */
  topic?: string;
}

export interface Post {
  post_id: UUID;
  channel_id: UUID;
  author_id: UUID;
  text?: string;
  /** Reference to a Creation rendered as a card, if any. */
  creation_id?: UUID | null;
  created_at: ISODateTime;
}

/** A user's membership in a space (community participation). */
export interface Membership {
  space_id: UUID;
  user_id: UUID;
  joined_at: ISODateTime;
}
