import {
  LicenseLedger,
  type Channel,
  type ConsentPolicy,
  type Creation,
  type ExportRequest,
  type IP,
  type LedgerEntry,
  type Listing,
  type Membership,
  type Order,
  type Post,
  type PromptTemplate,
  type Reaction,
  type Space,
  type User,
} from "@remix-hub/core";
import { newId, now } from "../ids.js";
import { seedData } from "./seed.js";
import type { Repo } from "./types.js";

/** In-memory Repo — default for dev/test. No external dependencies. */
export class MemoryRepo implements Repo {
  private users = new Map<string, User>();
  private usersByEmail = new Map<string, string>();
  private credentials = new Map<string, string>();
  private ips = new Map<string, IP>();
  private spaces = new Map<string, Space>();
  private channels = new Map<string, Channel>();
  private posts = new Map<string, Post>();
  private creations = new Map<string, Creation>();
  private exports = new Map<string, ExportRequest>();
  private listings = new Map<string, Listing>();
  private templates = new Map<string, PromptTemplate>();
  private orders = new Map<string, Order>();
  /** space_id → set of member user_ids. */
  private members = new Map<string, Set<string>>();
  /** key `${post_id}|${user_id}|${emoji}` → Reaction. */
  private reactions = new Map<string, Reaction>();
  /** user_id → (channel_id → peer_id) for DM conversations. */
  private dmThreads = new Map<string, Map<string, string>>();
  private ledger = new LicenseLedger();

  constructor(seed = true) {
    if (seed) this.seed();
  }

  private seed(): void {
    const data = seedData(now());
    for (const { user, email } of data.users) {
      this.users.set(user.user_id, user);
      this.usersByEmail.set(email, user.user_id);
    }
    for (const ip of data.ips) this.ips.set(ip.ip_id, ip);
    for (const s of data.spaces) this.spaces.set(s.space_id, s);
    for (const c of data.channels) this.channels.set(c.channel_id, c);
    for (const c of data.creations) this.creations.set(c.creation_id, c);
    for (const p of data.posts) this.posts.set(p.post_id, p);
    for (const m of data.memberships) {
      let set = this.members.get(m.space_id);
      if (!set) this.members.set(m.space_id, (set = new Set()));
      set.add(m.user_id);
    }
  }

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getUserByEmail(email: string) {
    const id = this.usersByEmail.get(email);
    return id ? (this.users.get(id) ?? null) : null;
  }
  async createUser(user: User, email: string, passwordHash: string) {
    this.users.set(user.user_id, user);
    this.usersByEmail.set(email, user.user_id);
    this.credentials.set(user.user_id, passwordHash);
  }
  async listUsers() {
    return [...this.users.values()];
  }
  async getCredential(userId: string) {
    return this.credentials.get(userId) ?? null;
  }
  async setCredential(userId: string, passwordHash: string) {
    this.credentials.set(userId, passwordHash);
  }

  async getIp(id: string) {
    return this.ips.get(id) ?? null;
  }
  async saveIp(ip: IP) {
    this.ips.set(ip.ip_id, ip);
  }
  async setIpPolicy(id: string, policy: ConsentPolicy) {
    const ip = this.ips.get(id);
    if (ip) ip.policy = policy;
  }

  async listSpaces() {
    return [...this.spaces.values()];
  }
  async getSpace(id: string) {
    return this.spaces.get(id) ?? null;
  }
  async saveSpace(space: Space) {
    this.spaces.set(space.space_id, space);
  }
  async listChannels(spaceId: string) {
    return [...this.channels.values()].filter((c) => c.space_id === spaceId);
  }
  async getChannel(id: string) {
    return this.channels.get(id) ?? null;
  }
  async saveChannel(channel: Channel) {
    this.channels.set(channel.channel_id, channel);
  }
  async listPosts(channelId: string) {
    return [...this.posts.values()].filter((p) => p.channel_id === channelId);
  }
  async getPost(id: string) {
    return this.posts.get(id) ?? null;
  }
  async createPost(post: Post) {
    this.posts.set(post.post_id, post);
  }

  async toggleReaction(r: Reaction) {
    const key = `${r.post_id}|${r.user_id}|${r.emoji}`;
    if (this.reactions.has(key)) {
      this.reactions.delete(key);
      return { added: false };
    }
    this.reactions.set(key, r);
    return { added: true };
  }
  async listReactions(postIds: string[]) {
    const set = new Set(postIds);
    return [...this.reactions.values()].filter((r) => set.has(r.post_id));
  }

  async addMember(m: Membership) {
    let set = this.members.get(m.space_id);
    if (!set) this.members.set(m.space_id, (set = new Set()));
    set.add(m.user_id);
    const space = this.spaces.get(m.space_id);
    if (space) space.member_count = set.size;
  }
  async removeMember(spaceId: string, userId: string) {
    const set = this.members.get(spaceId);
    set?.delete(userId);
    const space = this.spaces.get(spaceId);
    if (space) space.member_count = set?.size ?? 0;
  }
  async isMember(spaceId: string, userId: string) {
    return this.members.get(spaceId)?.has(userId) ?? false;
  }
  async listMembers(spaceId: string) {
    const ids = [...(this.members.get(spaceId) ?? [])];
    return ids.map((id) => this.users.get(id)).filter(Boolean) as User[];
  }
  async listSpacesForUser(userId: string) {
    return [...this.spaces.values()].filter((s) => this.members.get(s.space_id)?.has(userId));
  }

  async upsertDmThread(userId: string, channelId: string, peerId: string) {
    let m = this.dmThreads.get(userId);
    if (!m) this.dmThreads.set(userId, (m = new Map()));
    m.set(channelId, peerId);
  }
  async listDmThreads(userId: string) {
    return [...(this.dmThreads.get(userId)?.entries() ?? [])].map(([channel_id, peer_id]) => ({
      channel_id,
      peer_id,
    }));
  }

  async getCreation(id: string) {
    return this.creations.get(id) ?? null;
  }
  async saveCreation(creation: Creation) {
    this.creations.set(creation.creation_id, creation);
  }

  async getExport(id: string) {
    return this.exports.get(id) ?? null;
  }
  async saveExport(req: ExportRequest) {
    this.exports.set(req.export_id, req);
  }
  async listExports() {
    return [...this.exports.values()];
  }

  async appendLedger(input: {
    event_type: LedgerEntry["event_type"];
    actor: string;
    payload: Record<string, unknown>;
  }) {
    return this.ledger.append({ ...input, entry_id: newId("led"), timestamp: now() });
  }
  async listLedger() {
    return [...this.ledger.list()];
  }
  async ledgerHead() {
    return this.ledger.headHash;
  }
  async verifyLedger() {
    return this.ledger.verify();
  }

  async spaceWithIp(spaceId: string) {
    const space = this.spaces.get(spaceId);
    if (!space) return null;
    const ip = this.ips.get(space.ip_id);
    if (!ip) return null;
    return { space, ip };
  }

  async listListings() {
    return [...this.listings.values()];
  }
  async getListing(id: string) {
    return this.listings.get(id) ?? null;
  }
  async saveListing(listing: Listing) {
    this.listings.set(listing.listing_id, listing);
  }
  async listTemplates() {
    return [...this.templates.values()];
  }
  async getTemplate(id: string) {
    return this.templates.get(id) ?? null;
  }
  async saveTemplate(template: PromptTemplate) {
    this.templates.set(template.template_id, template);
  }
  async listOrders() {
    return [...this.orders.values()];
  }
  async saveOrder(order: Order) {
    this.orders.set(order.order_id, order);
  }
}
