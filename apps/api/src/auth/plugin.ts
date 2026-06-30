import fastifyJwt from "@fastify/jwt";
import type { Role } from "@remix-hub/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../ids.js";
import type { Store } from "../store.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthClaims } from "./types.js";

const DEV_SECRET = "remix-hub-dev-secret-change-me";

/** Default demo credentials seeded for the two seed users (dev only). */
const DEMO_PASSWORD = "password";

export function registerAuth(app: FastifyInstance, store: Store): void {
  // Queued like any Fastify plugin; loaded during app.ready(). req.jwtVerify /
  // app.jwt become available at handler time (post-ready).
  void app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? DEV_SECRET,
    sign: { expiresIn: "12h" },
  });

  // Verify the bearer token and attach claims to the request.
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const claims = await req.jwtVerify<AuthClaims>();
      req.authUser = claims;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // RBAC: require one of the given roles (run after `authenticate`).
  app.decorate("requireRole", (...roles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.authUser || !roles.includes(req.authUser.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }
    };
  });

  // Seed demo credentials once the server is ready (keeps buildServer sync).
  app.addHook("onReady", async () => {
    for (const user of store.users.values()) {
      if (!store.credentials.has(user.user_id)) {
        store.credentials.set(user.user_id, await hashPassword(DEMO_PASSWORD));
      }
    }
  });

  // --- Auth routes ---
  app.post("/auth/register", async (req, reply) => {
    const body = req.body as { email?: string; password?: string; role?: Role; display_name?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email_and_password_required" });
    }
    if (store.usersByEmail.has(body.email)) {
      return reply.code(409).send({ error: "email_taken" });
    }
    const user = {
      user_id: newId("user"),
      role: body.role ?? ("CREATOR" as Role),
      kyc_status: "none" as const,
      age_verified: false,
      display_name: body.display_name ?? body.email,
      payout_account: null,
    };
    store.users.set(user.user_id, user);
    store.usersByEmail.set(body.email, user.user_id);
    store.credentials.set(user.user_id, await hashPassword(body.password));

    const token = app.jwt.sign({ sub: user.user_id, role: user.role });
    return reply.code(201).send({ token, user });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email_and_password_required" });
    }
    const userId = store.usersByEmail.get(body.email);
    const hash = userId ? store.credentials.get(userId) : undefined;
    if (!userId || !hash || !(await verifyPassword(body.password, hash))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const user = store.users.get(userId)!;
    const token = app.jwt.sign({ sub: user.user_id, role: user.role });
    return { token, user };
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    const user = store.users.get(req.authUser!.sub);
    return { user };
  });
}
