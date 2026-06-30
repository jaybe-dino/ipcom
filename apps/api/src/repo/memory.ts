import {
  LicenseLedger,
  type Channel,
  type ConsentPolicy,
  type Creation,
  type ExportRequest,
  type IP,
  type LedgerEntry,
  type Post,
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
  async listChannels(spaceId: string) {
    return [...this.channels.values()].filter((c) => c.space_id === spaceId);
  }
  async listPosts(channelId: string) {
    return [...this.posts.values()].filter((p) => p.channel_id === channelId);
  }
  async createPost(post: Post) {
    this.posts.set(post.post_id, post);
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
}
