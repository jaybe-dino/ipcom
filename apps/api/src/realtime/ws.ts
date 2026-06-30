import fastifyWebsocket, { type WebSocket } from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { AuthClaims } from "../auth/types.js";
import type { EventBus } from "./bus.js";

/**
 * Real-time channel updates over WebSocket.
 *
 * Connect: GET /ws/channels/:id?token=<jwt>
 * (browsers can't set Authorization headers on WS, so the JWT is a query param.)
 * The server pushes ChannelEvent JSON frames for that channel until the socket
 * closes.
 */
export function registerRealtime(app: FastifyInstance, bus: EventBus): void {
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
        try {
          app.jwt.verify<AuthClaims>(token);
        } catch {
          socket.close(1008, "invalid_token");
          return;
        }

        const channelId = req.params.id;
        const unsubscribe = bus.subscribe(channelId, (event) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
        });

        socket.send(JSON.stringify({ type: "hello", channel_id: channelId }));
        socket.on("close", unsubscribe);
        socket.on("error", unsubscribe);
      },
    );
  });
}
