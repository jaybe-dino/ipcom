import type {
  Channel,
  ConsentPolicy,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  LedgerEventType,
  Listing,
  Membership,
  Notification,
  Order,
  Post,
  PromptTemplate,
  Reaction,
  Report,
  ReportStatus,
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
  saveIp(ip: IP): Promise<void>;
  setIpPolicy(id: string, policy: ConsentPolicy): Promise<void>;

  // Spaces / channels / posts
  listSpaces(): Promise<Space[]>;
  getSpace(id: string): Promise<Space | null>;
  saveSpace(space: Space): Promise<void>;
  listChannels(spaceId: string): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | null>;
  saveChannel(channel: Channel): Promise<void>;
  /** Newest `limit` posts (ascending), optionally older than the `before` cursor. */
  listPosts(
    channelId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<{ posts: Post[]; hasMore: boolean }>;
  getPost(id: string): Promise<Post | null>;
  createPost(post: Post): Promise<void>;
  updatePostText(id: string, text: string, editedAt: string): Promise<void>;
  deletePost(id: string): Promise<void>;

  // Reactions
  toggleReaction(reaction: Reaction): Promise<{ added: boolean }>;
  listReactions(postIds: string[]): Promise<Reaction[]>;

  // Community membership
  addMember(m: Membership): Promise<void>;
  removeMember(spaceId: string, userId: string): Promise<void>;
  isMember(spaceId: string, userId: string): Promise<boolean>;
  listMembers(spaceId: string): Promise<User[]>;
  listSpacesForUser(userId: string): Promise<Space[]>;

  // Direct messages (1:1)
  upsertDmThread(userId: string, channelId: string, peerId: string): Promise<void>;
  listDmThreads(userId: string): Promise<{ channel_id: string; peer_id: string }[]>;

  // Notifications
  addNotification(n: Notification): Promise<void>;
  listNotifications(userId: string, limit: number): Promise<Notification[]>;
  unreadCount(userId: string): Promise<number>;
  markNotificationsRead(userId: string): Promise<void>;

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

  // Marketplace
  listListings(): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | null>;
  saveListing(listing: Listing): Promise<void>;
  listTemplates(): Promise<PromptTemplate[]>;
  getTemplate(id: string): Promise<PromptTemplate | null>;
  saveTemplate(template: PromptTemplate): Promise<void>;
  listOrders(): Promise<Order[]>;
  saveOrder(order: Order): Promise<void>;

  // Moderation reports
  saveReport(report: Report): Promise<void>;
  getReport(id: string): Promise<Report | null>;
  listReports(status?: ReportStatus): Promise<Report[]>;
}
