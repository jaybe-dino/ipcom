import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { AuthClaims } from "../auth/types.js";
import type { EventBus } from "./bus.js";
import type { PresenceTracker } from "./presence.js";

/**
 * Real-time channel updates over WebSocket.
 *
 * Connect: GET /ws/channels/:id?token=<jwt>
 * (browsers can't set Authorization headers on WS, so the JWT is a query param.)
 * The server pushes ChannelEvent JSON frames for that channel until the socket
 * closes.
 */
export function registerRealtime(app: FastifyInstance, bus: EventBus, presence: PresenceTracker): void {
  void app.register(fastifyWebsocket);

  app.register(async (scoped) => {
    scoped.get<{ Params: { id: string }; Querystring: { token?: string } }>(
      "/ws/channels/:id",
      { websocket: true },
      (socket: WebSocket, req) => {
        // Authenticate the JWT supplied as a query param.
        const token = req.query.token;
        if (!token) {
          socket.close(1008, "missing_token");
          return;
        }
        let claims: AuthClaims;
        try {
          claims = app.jwt.verify<AuthClaims>(token);
        } catch {
          socket.close(1008, "invalid_token");
          return;
        }

        const channelId = req.params.id;
        const userId = claims.sub;
        const unsubscribe = bus.subscribe(channelId, (event) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
        });

        // Send hello first, then broadcast presence (so this socket's first
        // frame is always "hello", not its own presence echo).
        socket.send(JSON.stringify({ type: "hello", channel_id: channelId }));
        presence.add(userId);
        bus.publish({ type: "presence.updated", channel_id: channelId, user_id: userId, online: true });

        const cleanup = () => {
          unsubscribe();
          const wentOffline = presence.remove(userId);
          if (wentOffline) {
            bus.publish({ type: "presence.updated", channel_id: channelId, user_id: userId, online: false });
          }
        };
        socket.on("close", cleanup);
        socket.on("error", cleanup);
      },
    );
  });
}
