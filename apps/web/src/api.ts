import type {
  Channel,
  ConsentPolicy,
  Creation,
  ExportRequest,
  IP,
  LedgerEntry,
  Post,
  Space,
  UseType,
} from "@remix-hub/core";

/**
 * Thin REMIX HUB API client. Base URL defaults to "/api" (proxied to the
 * Fastify server in dev). Identity is sent via the x-user-id stub header.
 */
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function req<T>(path: string, init: RequestInit = {}, userId = "user_minji"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      ...(init.headers ?? {}),
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

export const api = {
  listSpaces: () => req<{ spaces: Space[] }>("/spaces"),
  getSpace: (id: string) => req<{ space: Space; ip: IP; channels: Channel[] }>(`/spaces/${id}`),
  getChannelPosts: (id: string) =>
    req<{ posts: Post[]; creations: Creation[] }>(`/channels/${id}/posts`),
  generate: (
    spaceId: string,
    body: { action: Creation["action"]; prompt: string },
    userId?: string,
  ) =>
    req<{ creation: Creation }>(
      `/spaces/${spaceId}/generations`,
      { method: "POST", body: JSON.stringify(body) },
      userId,
    ),
  requestExport: (creationId: string, body: { use_type: UseType; sale_price?: number }) =>
    req<{ export: ExportRequest }>(`/generations/${creationId}/export`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approveExport: (exportId: string, approve: boolean) =>
    req<{ export: ExportRequest }>(
      `/exports/${exportId}/approve`,
      { method: "POST", body: JSON.stringify({ approve }) },
      "user_owner_g",
    ),
  payExport: (exportId: string) =>
    req<{ export: ExportRequest; distribution: { owner: number; creator: number; platform: number } }>(
      `/exports/${exportId}/pay`,
      { method: "POST" },
      "user_owner_g",
    ),
  getConsent: (ipId: string) => req<{ ip_id: string; policy: ConsentPolicy }>(`/ip/${ipId}/consent`),
  getLedger: () =>
    req<{ entries: LedgerEntry[]; head_hash: string; integrity_ok: boolean }>("/ledger"),
};
