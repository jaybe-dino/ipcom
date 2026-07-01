import type {
  Channel,
  ConsentPolicy,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  Listing,
  Order,
  Post,
  PromptTemplate,
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
    getChannelPosts: (id: string) =>
      req<{ posts: Post[]; creations: Creation[]; authors: Record<string, AuthorRef> }>(
        `/channels/${id}/posts`,
      ),
    sendMessage: (channelId: string, text: string) =>
      req<{ post: Post }>(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    plugins: () => req<PluginInventory>("/plugins"),

    generate: (
      spaceId: string,
      body: { action: Creation["action"]; prompt: string; channel_id?: string },
    ) =>
      req<{ creation: Creation }>(`/spaces/${spaceId}/generations`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
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
    buyListing: (listingId: string) =>
      req<{ order: Order }>(`/market/listings/${listingId}/buy`, { method: "POST" }),
    listOrders: () => req<{ orders: Order[] }>("/market/orders"),
    getConsent: (ipId: string) =>
      req<{ ip_id: string; policy: ConsentPolicy }>(`/ip/${ipId}/consent`),
    getLedger: () =>
      req<{ entries: LedgerEntry[]; head_hash: string; integrity_ok: boolean }>("/ledger"),
  };

  return api;
}
