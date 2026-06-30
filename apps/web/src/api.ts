import type {
  Channel,
  ConsentPolicy,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  Post,
  Space,
  User,
  UseType,
} from "@remix-hub/core";
import { session } from "./session.js";

/**
 * Thin REMIX HUB API client. Base URL defaults to "/api" (proxied to the
 * Fastify server in dev). Identity is a JWT bearer token from the session.
 */
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

interface ReqOpts extends RequestInit {
  /** Override the bearer token (used for the owner-approval demo step). */
  token?: string | null;
}

async function req<T>(path: string, init: ReqOpts = {}): Promise<T> {
  const { token, ...rest } = init;
  const bearer = token === undefined ? session.token : token;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Cache an owner token for the demo gate flow (approval requires OWNER role).
let demoOwnerToken: string | null = null;
async function ownerToken(): Promise<string> {
  if (demoOwnerToken) return demoOwnerToken;
  const { token } = await api.login("owner@remixhub.dev", "password", false);
  demoOwnerToken = token;
  return token;
}

export const api = {
  async login(email: string, password: string, persist = true) {
    const out = await req<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      token: null,
    });
    if (persist) session.set(out);
    return out;
  },

  listSpaces: () => req<{ spaces: Space[] }>("/spaces"),
  getSpace: (id: string) => req<{ space: Space; ip: IP; channels: Channel[] }>(`/spaces/${id}`),
  getChannelPosts: (id: string) =>
    req<{ posts: Post[]; creations: Creation[] }>(`/channels/${id}/posts`),
  generate: (spaceId: string, body: { action: Creation["action"]; prompt: string }) =>
    req<{ creation: Creation }>(`/spaces/${spaceId}/generations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requestExport: (creationId: string, body: { use_type: UseType; sale_price?: number }) =>
    req<{ export: ExportRequest }>(`/generations/${creationId}/export`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Owner-only approval — uses a demo owner token so the flow completes. */
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
  getConsent: (ipId: string) => req<{ ip_id: string; policy: ConsentPolicy }>(`/ip/${ipId}/consent`),
  getLedger: () =>
    req<{ entries: LedgerEntry[]; head_hash: string; integrity_ok: boolean }>("/ledger"),
};
