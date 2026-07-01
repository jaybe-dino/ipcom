/** Real-time channel subscription, platform-agnostic (web/RN/desktop). */

export interface ChannelEvent {
  type:
    | "hello"
    | "post.created"
    | "post.updated"
    | "post.deleted"
    | "creation.updated"
    | "export.updated"
    | "reaction.updated"
    | "presence.updated"
    | "typing.updated";
  channel_id: string;
  [key: string]: unknown;
}

export interface SubscribeConfig {
  baseUrl?: string;
  token: string | null;
  channelId: string;
  onEvent: (e: ChannelEvent) => void;
  /** Override WebSocket (defaults to global; present on web/RN). */
  webSocketImpl?: typeof WebSocket;
  /** Web fallback origin used when baseUrl is relative ("/api"). */
  origin?: { protocol: string; host: string };
}

/** Resolve the WS URL from an absolute base, or from origin for a relative base. */
export function channelWsUrl(cfg: {
  baseUrl?: string;
  channelId: string;
  token: string;
  origin?: { protocol: string; host: string };
}): string {
  const base = cfg.baseUrl ?? "/api";
  const path = `/ws/channels/${cfg.channelId}?token=${encodeURIComponent(cfg.token)}`;
  if (base.startsWith("http")) return `${base.replace(/^http/, "ws")}${path}`;
  const origin = cfg.origin;
  if (!origin) throw new Error("relative baseUrl requires an origin");
  const proto = origin.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${origin.host}${base}${path}`;
}

/** Subscribe to a channel's events. Returns a cleanup function. No-op if no token. */
export function subscribeChannel(cfg: SubscribeConfig): () => void {
  if (!cfg.token) return () => {};
  const WS = cfg.webSocketImpl ?? globalThis.WebSocket;
  const url = channelWsUrl({
    baseUrl: cfg.baseUrl,
    channelId: cfg.channelId,
    token: cfg.token,
    origin: cfg.origin,
  });
  const ws = new WS(url);
  ws.onmessage = (ev: MessageEvent) => {
    try {
      cfg.onEvent(JSON.parse(ev.data as string) as ChannelEvent);
    } catch {
      // ignore malformed frames
    }
  };
  return () => {
    ws.onmessage = null;
    if (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING) ws.close();
  };
}
