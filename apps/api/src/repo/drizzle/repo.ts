import {
  GENESIS_HASH,
  LicenseLedger,
  hashEntry,
  type Channel,
  type ConsentPolicy,
  type Creation,
  type ExportRequest,
  type IP,
  type LedgerEntry,
  type Listing,
  type Membership,
  type Notification,
  type Order,
  type Post,
  type PromptTemplate,
  type Reaction,
  type Report,
  type ReportStatus,
  type Space,
  type User,
} from "@remix-hub/core";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { newId, now } from "../../ids.js";
import { seedData } from "../seed.js";
import type { Repo } from "../types.js";
import {
  channels,
  creations,
  dmThreads,
  exportRequests,
  ips,
  ledgerEntries,
  listings,
  memberships,
  notifications,
  orders,
  posts,
  promptTemplates,
  reactions,
  reports,
  schema,
  spaces,
  users,
} from "./schema.js";

export type DrizzleDB = NodePgDatabase<typeof schema>;

/**
 * Create all tables if absent (lightweight runtime migration). Statements run
 * one at a time because PGlite's extended-query protocol allows a single
 * statement per call (node-postgres handles them the same way).
 */
export async function migrate(db: DrizzleDB): Promise<void> {
  const statements = [
    sql`CREATE TABLE IF NOT EXISTS users (
      user_id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text,
      role text NOT NULL, kyc_status text NOT NULL DEFAULT 'none',
      age_verified boolean NOT NULL DEFAULT false, payout_account text, display_name text
    )`,
    sql`CREATE TABLE IF NOT EXISTS ips (
      ip_id text PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL,
      verification text NOT NULL, policy jsonb NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS spaces (
      space_id text PRIMARY KEY, ip_id text NOT NULL, name text NOT NULL, cover text,
      member_count integer NOT NULL DEFAULT 0, online_count integer NOT NULL DEFAULT 0
    )`,
    sql`CREATE TABLE IF NOT EXISTS channels (
      channel_id text PRIMARY KEY, space_id text NOT NULL, name text NOT NULL,
      type text NOT NULL, topic text
    )`,
    sql`CREATE TABLE IF NOT EXISTS posts (
      post_id text PRIMARY KEY, channel_id text NOT NULL, author_id text NOT NULL,
      text text, creation_id text, created_at timestamptz NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS creations (
      creation_id text PRIMARY KEY, ip_id text NOT NULL, creator_id text NOT NULL,
      plugin_id text NOT NULL, action text NOT NULL, prompt_ref text, parent_creation_id text,
      source_assets jsonb NOT NULL DEFAULT '[]', output_asset text,
      moderation jsonb NOT NULL, provenance jsonb, status text NOT NULL, created_at timestamptz NOT NULL
    )`,
    // Backfill for existing deployments created before lineage tracking.
    sql`ALTER TABLE creations ADD COLUMN IF NOT EXISTS parent_creation_id text`,
    sql`CREATE TABLE IF NOT EXISTS export_requests (
      export_id text PRIMARY KEY, creation_id text NOT NULL, requester_id text NOT NULL,
      use_type text NOT NULL, approval text NOT NULL, fee_amount bigint NOT NULL,
      split_snapshot jsonb NOT NULL, license_doc text, visible_label boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL, decided_at timestamptz, reject_reason text
    )`,
    sql`CREATE TABLE IF NOT EXISTS ledger_entries (
      entry_id text PRIMARY KEY, index integer NOT NULL, event_type text NOT NULL,
      actor text NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
      prev_hash text NOT NULL, timestamp text NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS prompt_templates (
      template_id text PRIMARY KEY, author_id text NOT NULL, ip_id text,
      title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS listings (
      listing_id text PRIMARY KEY, kind text NOT NULL, seller_id text NOT NULL,
      ref_id text NOT NULL, ip_id text, title text NOT NULL, price bigint NOT NULL,
      currency text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS orders (
      order_id text PRIMARY KEY, listing_id text NOT NULL, buyer_id text NOT NULL,
      seller_id text NOT NULL, amount bigint NOT NULL, distribution jsonb NOT NULL,
      license_doc text, status text NOT NULL, created_at timestamptz NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS memberships (
      space_id text NOT NULL, user_id text NOT NULL, joined_at timestamptz NOT NULL,
      PRIMARY KEY (space_id, user_id)
    )`,
    sql`CREATE TABLE IF NOT EXISTS reactions (
      post_id text NOT NULL, user_id text NOT NULL, emoji text NOT NULL,
      created_at timestamptz NOT NULL, PRIMARY KEY (post_id, user_id, emoji)
    )`,
    sql`CREATE TABLE IF NOT EXISTS dm_threads (
      user_id text NOT NULL, channel_id text NOT NULL, peer_id text NOT NULL,
      created_at timestamptz NOT NULL, PRIMARY KEY (user_id, channel_id)
    )`,
    sql`CREATE TABLE IF NOT EXISTS notifications (
      notification_id text PRIMARY KEY, user_id text NOT NULL, type text NOT NULL,
      actor_id text NOT NULL, channel_id text NOT NULL, post_id text NOT NULL,
      text text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS reports (
      report_id text PRIMARY KEY, target_type text NOT NULL, target_id text NOT NULL,
      reporter_id text NOT NULL, reason text NOT NULL, status text NOT NULL,
      created_at timestamptz NOT NULL, resolved_at timestamptz, resolver_id text, note text
    )`,
    // Additive columns for existing deployments (idempotent).
    sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_to text`,
    sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at timestamptz`,
    sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url text`,
  ];
  for (const stmt of statements) await db.execute(stmt);
}

function rowToUser(r: typeof users.$inferSelect): User {
  return {
    user_id: r.user_id,
    role: r.role,
    kyc_status: r.kyc_status,
    age_verified: r.age_verified,
    payout_account: r.payout_account,
    display_name: r.display_name ?? undefined,
  };
}

function rowToCreation(r: typeof creations.$inferSelect): Creation {
  return {
    creation_id: r.creation_id,
    ip_id: r.ip_id,
    creator_id: r.creator_id,
    plugin_id: r.plugin_id,
    action: r.action,
    prompt_ref: r.prompt_ref,
    parent_creation_id: r.parent_creation_id,
    source_assets: r.source_assets,
    output_asset: r.output_asset,
    moderation: r.moderation,
    provenance: r.provenance ?? undefined,
    status: r.status,
    created_at: r.created_at,
  };
}

function rowToSpace(r: typeof spaces.$inferSelect): Space {
  return { ...r, cover: r.cover ?? undefined };
}

function rowToPost(r: typeof posts.$inferSelect): Post {
  return {
    ...r,
    text: r.text ?? undefined,
    creation_id: r.creation_id,
    reply_to: r.reply_to,
    image_url: r.image_url,
    edited_at: r.edited_at,
  };
}

function rowToExport(r: typeof exportRequests.$inferSelect): ExportRequest {
  return {
    export_id: r.export_id,
    creation_id: r.creation_id,
    requester_id: r.requester_id,
    use_type: r.use_type,
    approval: r.approval,
    fee_amount: r.fee_amount,
    split_snapshot: r.split_snapshot,
    license_doc: r.license_doc,
    visible_label: r.visible_label,
    created_at: r.created_at,
    decided_at: r.decided_at,
    reject_reason: r.reject_reason,
  };
}

/** Postgres-backed Repo via Drizzle. Used when DATABASE_URL (or PGlite) is set. */
export class DrizzleRepo implements Repo {
  constructor(private readonly db: DrizzleDB) {}

  /** Insert the demo dataset if the DB is empty (idempotent). */
  async seedIfEmpty(): Promise<void> {
    const existing = await this.db.select({ id: users.user_id }).from(users).limit(1);
    if (existing.length > 0) return;
    const data = seedData(now());
    for (const { user, email } of data.users) {
      await this.db.insert(users).values({ ...user, email, password_hash: null }).onConflictDoNothing();
    }
    for (const ip of data.ips) await this.db.insert(ips).values(ip).onConflictDoNothing();
    for (const s of data.spaces) await this.db.insert(spaces).values(s).onConflictDoNothing();
    for (const c of data.channels) await this.db.insert(channels).values(c).onConflictDoNothing();
    for (const c of data.creations) await this.db.insert(creations).values(c).onConflictDoNothing();
    for (const p of data.posts) await this.db.insert(posts).values(p).onConflictDoNothing();
    for (const m of data.memberships) await this.db.insert(memberships).values(m).onConflictDoNothing();
  }

  async getUser(id: string) {
    const r = await this.db.select().from(users).where(eq(users.user_id, id)).limit(1);
    return r[0] ? rowToUser(r[0]) : null;
  }
  async getUserByEmail(email: string) {
    const r = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return r[0] ? rowToUser(r[0]) : null;
  }
  async createUser(user: User, email: string, passwordHash: string) {
    await this.db.insert(users).values({ ...user, email, password_hash: passwordHash });
  }
  async listUsers() {
    return (await this.db.select().from(users)).map(rowToUser);
  }
  async getCredential(userId: string) {
    const r = await this.db
      .select({ h: users.password_hash })
      .from(users)
      .where(eq(users.user_id, userId))
      .limit(1);
    return r[0]?.h ?? null;
  }
  async setCredential(userId: string, passwordHash: string) {
    await this.db.update(users).set({ password_hash: passwordHash }).where(eq(users.user_id, userId));
  }

  async getIp(id: string): Promise<IP | null> {
    const r = await this.db.select().from(ips).where(eq(ips.ip_id, id)).limit(1);
    return r[0] ?? null;
  }
  async saveIp(ip: IP) {
    await this.db.insert(ips).values(ip).onConflictDoUpdate({ target: ips.ip_id, set: ip });
  }
  async setIpPolicy(id: string, policy: ConsentPolicy) {
    await this.db.update(ips).set({ policy }).where(eq(ips.ip_id, id));
  }

  async listSpaces(): Promise<Space[]> {
    return (await this.db.select().from(spaces)).map(rowToSpace);
  }
  async getSpace(id: string): Promise<Space | null> {
    const r = await this.db.select().from(spaces).where(eq(spaces.space_id, id)).limit(1);
    return r[0] ? rowToSpace(r[0]) : null;
  }
  async saveSpace(space: Space) {
    await this.db.insert(spaces).values(space).onConflictDoUpdate({ target: spaces.space_id, set: space });
  }
  async listChannels(spaceId: string): Promise<Channel[]> {
    const rows = await this.db.select().from(channels).where(eq(channels.space_id, spaceId));
    return rows.map((c) => ({ ...c, topic: c.topic ?? undefined }));
  }
  async getChannel(id: string): Promise<Channel | null> {
    const r = await this.db.select().from(channels).where(eq(channels.channel_id, id)).limit(1);
    return r[0] ? { ...r[0], topic: r[0].topic ?? undefined } : null;
  }
  async saveChannel(channel: Channel) {
    await this.db
      .insert(channels)
      .values(channel)
      .onConflictDoUpdate({ target: channels.channel_id, set: channel });
  }
  async listPosts(channelId: string, opts: { limit?: number; before?: string } = {}) {
    const limit = opts.limit ?? 50;
    const where = opts.before
      ? and(eq(posts.channel_id, channelId), lt(posts.created_at, opts.before))
      : eq(posts.channel_id, channelId);
    const rows = await this.db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.created_at))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // ascending
    return { posts: page.map(rowToPost), hasMore };
  }
  async getPost(id: string): Promise<Post | null> {
    const r = await this.db.select().from(posts).where(eq(posts.post_id, id)).limit(1);
    return r[0] ? rowToPost(r[0]) : null;
  }
  async createPost(post: Post) {
    await this.db.insert(posts).values(post).onConflictDoNothing();
  }
  async updatePostText(id: string, text: string, editedAt: string) {
    await this.db.update(posts).set({ text, edited_at: editedAt }).where(eq(posts.post_id, id));
  }
  async deletePost(id: string) {
    await this.db.delete(reactions).where(eq(reactions.post_id, id));
    await this.db.delete(posts).where(eq(posts.post_id, id));
  }

  async toggleReaction(r: Reaction): Promise<{ added: boolean }> {
    const where = and(
      eq(reactions.post_id, r.post_id),
      eq(reactions.user_id, r.user_id),
      eq(reactions.emoji, r.emoji),
    );
    const existing = await this.db.select().from(reactions).where(where).limit(1);
    if (existing.length) {
      await this.db.delete(reactions).where(where);
      return { added: false };
    }
    await this.db.insert(reactions).values(r).onConflictDoNothing();
    return { added: true };
  }
  async listReactions(postIds: string[]): Promise<Reaction[]> {
    if (!postIds.length) return [];
    return this.db.select().from(reactions).where(inArray(reactions.post_id, postIds));
  }

  private async refreshMemberCount(spaceId: string) {
    const rows = await this.db
      .select({ uid: memberships.user_id })
      .from(memberships)
      .where(eq(memberships.space_id, spaceId));
    await this.db.update(spaces).set({ member_count: rows.length }).where(eq(spaces.space_id, spaceId));
  }
  async addMember(m: Membership) {
    await this.db.insert(memberships).values(m).onConflictDoNothing();
    await this.refreshMemberCount(m.space_id);
  }
  async removeMember(spaceId: string, userId: string) {
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.space_id, spaceId), eq(memberships.user_id, userId)));
    await this.refreshMemberCount(spaceId);
  }
  async isMember(spaceId: string, userId: string): Promise<boolean> {
    const r = await this.db
      .select({ uid: memberships.user_id })
      .from(memberships)
      .where(and(eq(memberships.space_id, spaceId), eq(memberships.user_id, userId)))
      .limit(1);
    return r.length > 0;
  }
  async listMembers(spaceId: string): Promise<User[]> {
    const ms = await this.db
      .select({ uid: memberships.user_id })
      .from(memberships)
      .where(eq(memberships.space_id, spaceId));
    const ids = ms.map((m) => m.uid);
    if (!ids.length) return [];
    return (await this.db.select().from(users).where(inArray(users.user_id, ids))).map(rowToUser);
  }
  async listSpacesForUser(userId: string): Promise<Space[]> {
    const ms = await this.db
      .select({ sid: memberships.space_id })
      .from(memberships)
      .where(eq(memberships.user_id, userId));
    const ids = ms.map((m) => m.sid);
    if (!ids.length) return [];
    return (await this.db.select().from(spaces).where(inArray(spaces.space_id, ids))).map(rowToSpace);
  }

  async upsertDmThread(userId: string, channelId: string, peerId: string) {
    await this.db
      .insert(dmThreads)
      .values({ user_id: userId, channel_id: channelId, peer_id: peerId, created_at: now() })
      .onConflictDoNothing();
  }
  async listDmThreads(userId: string) {
    const rows = await this.db
      .select({ channel_id: dmThreads.channel_id, peer_id: dmThreads.peer_id })
      .from(dmThreads)
      .where(eq(dmThreads.user_id, userId));
    return rows;
  }

  async addNotification(n: Notification) {
    await this.db.insert(notifications).values(n).onConflictDoNothing();
  }
  async listNotifications(userId: string, limit: number): Promise<Notification[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, userId))
      .orderBy(desc(notifications.created_at))
      .limit(limit);
  }
  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: notifications.notification_id })
      .from(notifications)
      .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)));
    return rows.length;
  }
  async markNotificationsRead(userId: string) {
    await this.db.update(notifications).set({ read: true }).where(eq(notifications.user_id, userId));
  }

  async getCreation(id: string) {
    const r = await this.db.select().from(creations).where(eq(creations.creation_id, id)).limit(1);
    return r[0] ? rowToCreation(r[0]) : null;
  }
  async saveCreation(creation: Creation) {
    await this.db
      .insert(creations)
      .values(creation)
      .onConflictDoUpdate({ target: creations.creation_id, set: creation });
  }
  async listCreationChildren(id: string) {
    const rows = await this.db.select().from(creations).where(eq(creations.parent_creation_id, id));
    return rows.map(rowToCreation);
  }

  async getExport(id: string) {
    const r = await this.db.select().from(exportRequests).where(eq(exportRequests.export_id, id)).limit(1);
    return r[0] ? rowToExport(r[0]) : null;
  }
  async saveExport(req: ExportRequest) {
    await this.db
      .insert(exportRequests)
      .values(req)
      .onConflictDoUpdate({ target: exportRequests.export_id, set: req });
  }
  async listExports() {
    return (await this.db.select().from(exportRequests)).map(rowToExport);
  }

  async appendLedger(input: {
    event_type: LedgerEntry["event_type"];
    actor: string;
    payload: Record<string, unknown>;
  }): Promise<LedgerEntry> {
    const last = await this.db
      .select()
      .from(ledgerEntries)
      .orderBy(desc(ledgerEntries.index))
      .limit(1);
    const index = last[0] ? last[0].index + 1 : 0;
    const prev_hash = last[0]?.payload_hash ?? GENESIS_HASH;
    const entry_id = newId("led");
    const timestamp = now();
    const payload_hash = hashEntry(
      index,
      { entry_id, event_type: input.event_type, actor: input.actor, payload: input.payload, timestamp },
      prev_hash,
    );
    const entry: LedgerEntry = {
      entry_id,
      index,
      event_type: input.event_type,
      actor: input.actor,
      payload: input.payload,
      payload_hash,
      prev_hash,
      timestamp,
    };
    await this.db.insert(ledgerEntries).values(entry);
    return entry;
  }
  async listLedger(): Promise<LedgerEntry[]> {
    return this.db.select().from(ledgerEntries).orderBy(ledgerEntries.index);
  }
  async ledgerHead() {
    const last = await this.db
      .select({ h: ledgerEntries.payload_hash })
      .from(ledgerEntries)
      .orderBy(desc(ledgerEntries.index))
      .limit(1);
    return last[0]?.h ?? GENESIS_HASH;
  }
  async verifyLedger() {
    const rows = await this.listLedger();
    return new LicenseLedger(rows).verify();
  }

  async spaceWithIp(spaceId: string) {
    const space = await this.getSpace(spaceId);
    if (!space) return null;
    const ip = await this.getIp(space.ip_id);
    if (!ip) return null;
    return { space, ip };
  }

  async listListings(): Promise<Listing[]> {
    return (await this.db.select().from(listings)).map((l) => ({ ...l, ip_id: l.ip_id }));
  }
  async getListing(id: string): Promise<Listing | null> {
    const r = await this.db.select().from(listings).where(eq(listings.listing_id, id)).limit(1);
    return r[0] ?? null;
  }
  async saveListing(listing: Listing) {
    await this.db
      .insert(listings)
      .values(listing)
      .onConflictDoUpdate({ target: listings.listing_id, set: listing });
  }
  async listTemplates(): Promise<PromptTemplate[]> {
    return this.db.select().from(promptTemplates);
  }
  async getTemplate(id: string): Promise<PromptTemplate | null> {
    const r = await this.db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.template_id, id))
      .limit(1);
    return r[0] ?? null;
  }
  async saveTemplate(template: PromptTemplate) {
    await this.db
      .insert(promptTemplates)
      .values(template)
      .onConflictDoUpdate({ target: promptTemplates.template_id, set: template });
  }
  async listOrders(): Promise<Order[]> {
    return this.db.select().from(orders);
  }
  async saveOrder(order: Order) {
    await this.db
      .insert(orders)
      .values(order)
      .onConflictDoUpdate({ target: orders.order_id, set: order });
  }

  async saveReport(report: Report) {
    await this.db
      .insert(reports)
      .values(report)
      .onConflictDoUpdate({ target: reports.report_id, set: report });
  }
  async getReport(id: string): Promise<Report | null> {
    const r = await this.db.select().from(reports).where(eq(reports.report_id, id)).limit(1);
    return r[0] ?? null;
  }
  async listReports(status?: ReportStatus): Promise<Report[]> {
    if (status) return this.db.select().from(reports).where(eq(reports.status, status));
    return this.db.select().from(reports);
  }
}
