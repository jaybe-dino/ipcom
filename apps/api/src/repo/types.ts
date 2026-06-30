import type {
  Channel,
  ConsentPolicy,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  LedgerEventType,
  Post,
  Space,
  User,
} from "@remix-hub/core";

/**
 * Persistence boundary. The application service and routes depend ONLY on this
 * interface, so the storage engine (in-memory vs Drizzle/Postgres) is swappable
 * without touching business logic. All methods are async.
 */
export interface Repo {
  // Users & credentials
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(user: User, email: string, passwordHash: string): Promise<void>;
  listUsers(): Promise<User[]>;
  getCredential(userId: string): Promise<string | null>;
  setCredential(userId: string, passwordHash: string): Promise<void>;

  // IP / Consent
  getIp(id: string): Promise<IP | null>;
  setIpPolicy(id: string, policy: ConsentPolicy): Promise<void>;

  // Spaces / channels / posts
  listSpaces(): Promise<Space[]>;
  getSpace(id: string): Promise<Space | null>;
  listChannels(spaceId: string): Promise<Channel[]>;
  listPosts(channelId: string): Promise<Post[]>;
  createPost(post: Post): Promise<void>;

  // Creations
  getCreation(id: string): Promise<Creation | null>;
  saveCreation(creation: Creation): Promise<void>;

  // Exports
  getExport(id: string): Promise<ExportRequest | null>;
  saveExport(req: ExportRequest): Promise<void>;
  listExports(): Promise<ExportRequest[]>;

  // License Ledger (append-only hash chain)
  appendLedger(input: {
    event_type: LedgerEventType;
    actor: string;
    payload: Record<string, unknown>;
  }): Promise<LedgerEntry>;
  listLedger(): Promise<LedgerEntry[]>;
  ledgerHead(): Promise<string>;
  /** First broken index, or -1 if the chain is intact. */
  verifyLedger(): Promise<number>;

  /** Convenience: a space plus its backing IP. */
  spaceWithIp(spaceId: string): Promise<{ space: Space; ip: IP } | null>;
}
