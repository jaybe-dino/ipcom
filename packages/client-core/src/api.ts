import type {
  Channel,
  ConsentPolicy,
  Coupon,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  Listing,
  Notification,
  Order,
  Post,
  PromptTemplate,
  ReactionSummary,
  Report,
  SettlementSummary,
  Space,
  User,
  UseType,
} from "@remix-hub/core";
import type { Session } from "./session.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ClientConfig {
  /** API base URL. "/api" (web dev proxy) or absolute (mobile/desktop). */
  baseUrl?: string;
  session: Session;
  /** Override fetch (defaults to global fetch — present on web, RN, Node 18+). */
  fetchImpl?: typeof fetch;
}

export interface PluginInventory {
  plugins: { id: string; capabilities: string[] }[];
}

export interface AuthorRef {
  user_id: string;
  display_name?: string;
  role: User["role"];
  /** Present in member lists: whether the user is currently connected. */
  online?: boolean;
}

export type Api = ReturnType<typeof createApi>;

/**
 * Build the REMIX HUB API client. Identity comes from the injected Session's
 * JWT; the same client runs on every platform.
 */
export function createApi(cfg: ClientConfig) {
  const baseUrl = cfg.baseUrl ?? "/api";
  const doFetch = cfg.fetchImpl ?? globalThis.fetch;

  async function req<T>(
    path: string,
    init: RequestInit & { token?: string | null } = {},
  ): Promise<T> {
    const { token, ...rest } = init;
    const bearer = token === undefined ? cfg.session.token : token;
    const res = await doFetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        // Only declare a JSON content-type when a body is actually sent —
        // otherwise strict servers (Fastify) reject the empty body.
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(rest.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      // Expired/invalid session: clear it so the app returns to login instead
      // of failing every action with a cryptic error.
      if (res.status === 401 && bearer) cfg.session.clear();
      throw new ApiError(res.status, body.error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  // Cache an owner token for the demo gate flow (approval requires OWNER role).
  let demoOwnerToken: string | null = null;
  async function ownerToken(): Promise<string> {
    if (demoOwnerToken) return demoOwnerToken;
    const { token } = await api.login("owner@remixhub.dev", "password", false);
    demoOwnerToken = token;
    return token;
  }

  const api = {
    async login(email: string, password: string, persist = true) {
      const out = await req<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        token: null,
      });
      if (persist) cfg.session.set(out);
      return out;
    },
    async register(body: { email: string; password: string; role?: User["role"]; display_name?: string }) {
      const out = await req<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
        token: null,
      });
      cfg.session.set(out);
      return out;
    },

    listSpaces: () => req<{ spaces: Space[] }>("/spaces"),
    getSpace: (id: string) => req<{ space: Space; ip: IP; channels: Channel[] }>(`/spaces/${id}`),
    mySpaces: () => req<{ spaces: Space[] }>("/me/spaces"),
    search: (q: string) =>
      req<{
        query: string;
        spaces: Space[];
        users: { user_id: string; display_name?: string; role: string }[];
        listings: Listing[];
      }>(`/search?q=${encodeURIComponent(q)}`),
    createSpace: (name: string) =>
      req<{ space: Space }>("/spaces", { method: "POST", body: JSON.stringify({ name }) }),
    createChannel: (spaceId: string, body: { name: string; type?: Channel["type"]; topic?: string }) =>
      req<{ channel: Channel }>(`/spaces/${spaceId}/channels`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    joinSpace: (id: string) => req<{ space: Space }>(`/spaces/${id}/join`, { method: "POST" }),
    leaveSpace: (id: string) => req<{ left: boolean }>(`/spaces/${id}/leave`, { method: "POST" }),
    spaceMembers: (id: string) => req<{ members: AuthorRef[] }>(`/spaces/${id}/members`),

    // Direct messages
    openDm: (userId: string) => req<{ channel_id: string; peer: User }>(`/dm/${userId}`, { method: "POST" }),
    myDms: () => req<{ dms: { channel_id: string; peer: User }[] }>("/me/dms"),

    // Notifications
    notifications: () => req<{ notifications: Notification[]; unread: number }>("/me/notifications"),
    unreadCount: () => req<{ count: number }>("/me/notifications/unread_count"),
    markNotificationsRead: () => req<{ ok: boolean }>("/me/notifications/read", { method: "POST" }),
    getChannelPosts: (id: string, opts: { limit?: number; before?: string } = {}) => {
      const qs = new URLSearchParams();
      if (opts.limit) qs.set("limit", String(opts.limit));
      if (opts.before) qs.set("before", opts.before);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return req<{
        posts: Post[];
        creations: Creation[];
        authors: Record<string, AuthorRef>;
        reactions: Record<string, ReactionSummary[]>;
        hasMore: boolean;
      }>(`/channels/${id}/posts${suffix}`);
    },
    sendMessage: (
      channelId: string,
      text: string,
      opts: { replyTo?: string | null; imageUrl?: string | null } = {},
    ) =>
      req<{ post: Post }>(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          text,
          reply_to: opts.replyTo ?? undefined,
          image_url: opts.imageUrl ?? undefined,
        }),
      }),
    react: (postId: string, emoji: string) =>
      req<{ added: boolean }>(`/posts/${postId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }),
    typing: (channelId: string) =>
      req<{ ok: boolean }>(`/channels/${channelId}/typing`, { method: "POST" }),
    editMessage: (postId: string, text: string) =>
      req<{ post: Post }>(`/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ text }) }),
    deleteMessage: (postId: string) => req<{ deleted: boolean }>(`/posts/${postId}`, { method: "DELETE" }),
    plugins: () => req<PluginInventory>("/plugins"),

    generate: (
      spaceId: string,
      body: {
        action: Creation["action"];
        prompt: string;
        channel_id?: string;
        parent_creation_id?: string;
        plugin_id?: string;
      },
    ) =>
      req<{ creation: Creation }>(`/spaces/${spaceId}/generations`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    lineage: (creationId: string) =>
      req<{ creation: Creation; ancestors: Creation[]; children: Creation[]; depth: number }>(
        `/generations/${creationId}/lineage`,
      ),
    requestExport: (creationId: string, body: { use_type: UseType; sale_price?: number }) =>
      req<{ export: ExportRequest }>(`/generations/${creationId}/export`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    async approveExport(exportId: string, approve: boolean) {
      return req<{ export: ExportRequest }>(`/exports/${exportId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approve }),
        token: await ownerToken(),
      });
    },
    payExport: (exportId: string) =>
      req<{
        export: ExportRequest;
        distribution: { owner: number; creator: number; platform: number };
      }>(`/exports/${exportId}/pay`, { method: "POST" }),
    getLicense: (exportId: string) =>
      req<{ license: Record<string, unknown> }>(`/exports/${exportId}/license`),

    // Marketplace
    marketCatalog: () => req<{ listings: Listing[]; templates: PromptTemplate[] }>("/market/listings"),
    createTemplate: (body: { title: string; body: string; ip_id?: string }) =>
      req<{ template: PromptTemplate }>("/market/templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createListing: (body: {
      kind: "creation" | "template";
      ref_id: string;
      title: string;
      price: number;
    }) =>
      req<{ listing: Listing }>("/market/listings", { method: "POST", body: JSON.stringify(body) }),
    buyListing: (listingId: string, couponCode?: string) =>
      req<{ order: Order }>(`/market/listings/${listingId}/buy`, {
        method: "POST",
        // Only send a body when a coupon is supplied, so bodyless buys stay
        // Content-Type-free (Fastify rejects an empty JSON body otherwise).
        ...(couponCode ? { body: JSON.stringify({ coupon_code: couponCode }) } : {}),
      }),
    listOrders: () => req<{ orders: Order[] }>("/market/orders"),
    // Promo coupons (ADMIN/OWNER manage).
    listCoupons: () => req<{ coupons: Coupon[] }>("/market/coupons"),
    createCoupon: (body: {
      code: string;
      kind: "percent" | "fixed";
      value: number;
      min_price?: number;
      max_redemptions?: number | null;
      expires_at?: string | null;
    }) => req<{ coupon: Coupon }>("/market/coupons", { method: "POST", body: JSON.stringify(body) }),
    // Buyer portal: my purchases + per-order license manifest.
    myOrders: () => req<{ orders: (Order & { listing_title: string })[] }>("/me/orders"),
    orderLicense: (id: string) => req<{ license: unknown }>(`/me/orders/${id}/license`),
    // Seller portal: my sales + earnings totals.
    mySales: () =>
      req<{
        sales: (Order & { listing_title: string })[];
        totals: { count: number; gross: number; earned: number; platform_fees: number };
      }>("/me/sales"),
    getConsent: (ipId: string) =>
      req<{ ip_id: string; policy: ConsentPolicy }>(`/ip/${ipId}/consent`),
    getLedger: () =>
      req<{ entries: LedgerEntry[]; head_hash: string; integrity_ok: boolean }>("/ledger"),
    settlementSummary: (days = 14) =>
      req<SettlementSummary>(`/settlement/summary?days=${days}`),
    // Admin: moderation report queue (ADMIN/OWNER only).
    adminReports: (status?: Report["status"]) =>
      req<{ reports: Report[] }>(`/admin/reports${status ? `?status=${status}` : ""}`),
    resolveReport: (id: string, body: { action: "actioned" | "dismissed"; note?: string }) =>
      req<{ report: Report }>(`/admin/reports/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    remindExpiringLicenses: (withinDays = 14) =>
      req<{
        reminded: number;
        expiring: { export_id: string; requester_id: string; valid_until: string; days_left: number }[];
      }>("/admin/licenses/remind", { method: "POST", body: JSON.stringify({ within_days: withinDays }) }),
  };

  return api;
}
