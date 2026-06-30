import { session } from "./session.js";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface ChannelEvent {
  type: "hello" | "post.created" | "creation.updated" | "export.updated";
  channel_id: string;
  [key: string]: unknown;
}

/** Resolve the WS URL for a channel, honoring an absolute or "/api" base. */
function wsUrl(channelId: string, token: string): string {
  const path = `/ws/channels/${channelId}?token=${encodeURIComponent(token)}`;
  if (BASE.startsWith("http")) {
    return `${BASE.replace(/^http/, "ws")}${path}`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${BASE}${path}`;
}

/**
 * Subscribe to a channel's live events. Returns a cleanup function. No-op (and
 * returns a noop cleanup) when the user is not authenticated.
 */
export function subscribeChannel(channelId: string, onEvent: (e: ChannelEvent) => void): () => void {
  const token = session.token;
  if (!token) return () => {};

  const ws = new WebSocket(wsUrl(channelId, token));
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data as string) as ChannelEvent);
    } catch {
      // ignore malformed frames
    }
  };
  return () => {
    ws.onmessage = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };
}
