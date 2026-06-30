import { subscribeChannel as coreSubscribe, type ChannelEvent } from "@remix-hub/client-core";
import { session } from "./session.js";

const baseUrl = import.meta.env.VITE_API_BASE ?? "/api";

export type { ChannelEvent };

/** Subscribe to a channel's live events using the web session token + origin. */
export function subscribeChannel(channelId: string, onEvent: (e: ChannelEvent) => void): () => void {
  return coreSubscribe({
    baseUrl,
    token: session.token,
    channelId,
    onEvent,
    origin: { protocol: location.protocol, host: location.host },
  });
}
