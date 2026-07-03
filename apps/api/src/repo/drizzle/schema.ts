import type {
  ConsentPolicy,
  CreationStatus,
  CreativeAction,
  KycStatus,
  ModerationResult,
  Provenance,
  Role,
  UseType,
  Verification,
} from "@remix-hub/core";
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Postgres schema for REMIX HUB. Rich domain objects are stored as jsonb. */

export const users = pgTable("users", {
  user_id: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash"),
  role: text("role").$type<Role>().notNull(),
  kyc_status: text("kyc_status").$type<KycStatus>().notNull().default("none"),
  age_verified: boolean("age_verified").notNull().default(false),
  payout_account: text("payout_account"),
  display_name: text("display_name"),
});

export const ips = pgTable("ips", {
  ip_id: text("ip_id").primaryKey(),
  owner_id: text("owner_id").notNull(),
  name: text("name").notNull(),
  verification: text("verification").$type<Verification>().notNull(),
  policy: jsonb("policy").$type<ConsentPolicy>().notNull(),
});

export const spaces = pgTable("spaces", {
  space_id: text("space_id").primaryKey(),
  ip_id: text("ip_id").notNull(),
  name: text("name").notNull(),
  cover: text("cover"),
  member_count: integer("member_count").notNull().default(0),
  online_count: integer("online_count").notNull().default(0),
});

export const channels = pgTable("channels", {
  channel_id: text("channel_id").primaryKey(),
  space_id: text("space_id").notNull(),
  name: text("name").notNull(),
  type: text("type").$type<"creation" | "community" | "market">().notNull(),
  topic: text("topic"),
});

export const posts = pgTable("posts", {
  post_id: text("post_id").primaryKey(),
  channel_id: text("channel_id").notNull(),
  author_id: text("author_id").notNull(),
  text: text("text"),
  creation_id: text("creation_id"),
  reply_to: text("reply_to"),
  image_url: text("image_url"),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  edited_at: timestamp("edited_at", { mode: "string", withTimezone: true }),
});

export const reactions = pgTable(
  "reactions",
  {
    post_id: text("post_id").notNull(),
    user_id: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.post_id, t.user_id, t.emoji] }) }),
);

export const creations = pgTable("creations", {
  creation_id: text("creation_id").primaryKey(),
  ip_id: text("ip_id").notNull(),
  creator_id: text("creator_id").notNull(),
  plugin_id: text("plugin_id").notNull(),
  action: text("action").$type<CreativeAction>().notNull(),
  prompt_ref: text("prompt_ref"),
  parent_creation_id: text("parent_creation_id"),
  source_assets: jsonb("source_assets").$type<string[]>().notNull().default([]),
  output_asset: text("output_asset"),
  moderation: jsonb("moderation").$type<ModerationResult>().notNull(),
  provenance: jsonb("provenance").$type<Provenance>(),
  status: text("status").$type<CreationStatus>().notNull(),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const exportRequests = pgTable("export_requests", {
  export_id: text("export_id").primaryKey(),
  creation_id: text("creation_id").notNull(),
  requester_id: text("requester_id").notNull(),
  use_type: text("use_type").$type<UseType>().notNull(),
  approval: text("approval").$type<"auto" | "pending" | "approved" | "rejected">().notNull(),
  fee_amount: bigint("fee_amount", { mode: "number" }).notNull(),
  split_snapshot: jsonb("split_snapshot")
    .$type<{ owner: number; creator: number; platform: number }>()
    .notNull(),
  license_doc: text("license_doc"),
  visible_label: boolean("visible_label").notNull().default(true),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  decided_at: timestamp("decided_at", { mode: "string", withTimezone: true }),
  reject_reason: text("reject_reason"),
});

export const ledgerEntries = pgTable("ledger_entries", {
  entry_id: text("entry_id").primaryKey(),
  index: integer("index").notNull(),
  event_type: text("event_type").$type<"create" | "export" | "settle" | "adjust">().notNull(),
  actor: text("actor").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payload_hash: text("payload_hash").notNull(),
  prev_hash: text("prev_hash").notNull(),
  // Stored as text so the exact ISO string round-trips — it is part of the
  // integrity hash, and timestamptz would reformat it and break the chain.
  timestamp: text("timestamp").notNull(),
});

export const promptTemplates = pgTable("prompt_templates", {
  template_id: text("template_id").primaryKey(),
  author_id: text("author_id").notNull(),
  ip_id: text("ip_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const listings = pgTable("listings", {
  listing_id: text("listing_id").primaryKey(),
  kind: text("kind").$type<"creation" | "template">().notNull(),
  seller_id: text("seller_id").notNull(),
  ref_id: text("ref_id").notNull(),
  ip_id: text("ip_id"),
  title: text("title").notNull(),
  price: bigint("price", { mode: "number" }).notNull(),
  currency: text("currency").$type<"KRW" | "USD" | "JPY" | "EUR">().notNull(),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const orders = pgTable("orders", {
  order_id: text("order_id").primaryKey(),
  listing_id: text("listing_id").notNull(),
  buyer_id: text("buyer_id").notNull(),
  seller_id: text("seller_id").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  distribution: jsonb("distribution")
    .$type<{ owner: number; creator: number; platform: number }>()
    .notNull(),
  license_doc: text("license_doc"),
  coupon_code: text("coupon_code"),
  discount: bigint("discount", { mode: "number" }),
  status: text("status").$type<"paid" | "refunded">().notNull(),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const coupons = pgTable("coupons", {
  code: text("code").primaryKey(),
  kind: text("kind").$type<"percent" | "fixed">().notNull(),
  value: doublePrecision("value").notNull(),
  min_price: bigint("min_price", { mode: "number" }),
  max_redemptions: integer("max_redemptions"),
  redemptions: integer("redemptions").notNull().default(0),
  active: boolean("active").notNull().default(true),
  expires_at: timestamp("expires_at", { mode: "string", withTimezone: true }),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    space_id: text("space_id").notNull(),
    user_id: text("user_id").notNull(),
    joined_at: timestamp("joined_at", { mode: "string", withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.space_id, t.user_id] }) }),
);

export const dmThreads = pgTable(
  "dm_threads",
  {
    user_id: text("user_id").notNull(),
    channel_id: text("channel_id").notNull(),
    peer_id: text("peer_id").notNull(),
    created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.user_id, t.channel_id] }) }),
);

export const notifications = pgTable("notifications", {
  notification_id: text("notification_id").primaryKey(),
  user_id: text("user_id").notNull(),
  type: text("type")
    .$type<"mention" | "reply" | "dm" | "export_decision" | "settlement" | "license_expiry">()
    .notNull(),
  actor_id: text("actor_id").notNull(),
  channel_id: text("channel_id"),
  post_id: text("post_id"),
  text: text("text").notNull(),
  read: boolean("read").notNull().default(false),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
});

export const reports = pgTable("reports", {
  report_id: text("report_id").primaryKey(),
  target_type: text("target_type").$type<"creation" | "post" | "space">().notNull(),
  target_id: text("target_id").notNull(),
  reporter_id: text("reporter_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"open" | "actioned" | "dismissed">().notNull(),
  created_at: timestamp("created_at", { mode: "string", withTimezone: true }).notNull(),
  resolved_at: timestamp("resolved_at", { mode: "string", withTimezone: true }),
  resolver_id: text("resolver_id"),
  note: text("note"),
});

export const schema = {
  users,
  ips,
  spaces,
  channels,
  posts,
  creations,
  exportRequests,
  ledgerEntries,
  promptTemplates,
  listings,
  orders,
  memberships,
  reactions,
  dmThreads,
  notifications,
  reports,
  coupons,
};
