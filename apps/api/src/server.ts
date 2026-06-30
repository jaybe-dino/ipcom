import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import { revisePolicy, type CreativeAction, type UseType } from "@remix-hub/core";
import Fastify from "fastify";
import { RemixService } from "./service.js";
import { Store } from "./store.js";

/**
 * REMIX HUB API (MVP scaffold).
 *
 * Auth is stubbed: the caller's identity comes from the `x-user-id` header.
 * Replace with OAuth2/JWT + RBAC (PRD §6) before any real deployment.
 */
export function buildServer() {
  const store = new Store();
  const service = new RemixService(store);
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  const actor = (req: { headers: Record<string, unknown> }): string =>
    (req.headers["x-user-id"] as string) || "user_minji";

  app.get("/health", async () => ({ status: "ok", service: "remix-hub-api", version: "0.1.0" }));

  // --- Spaces & channels (Community Service) ---
  app.get("/spaces", async () => ({ spaces: [...store.spaces.values()] }));

  app.get("/spaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = store.spaceWithIp(id);
    if (!ctx) return reply.code(404).send({ error: "space_not_found" });
    const channels = [...store.channels.values()].filter((c) => c.space_id === id);
    return { space: ctx.space, ip: ctx.ip, channels };
  });

  app.get("/channels/:id/posts", async (req) => {
    const { id } = req.params as { id: string };
    const posts = [...store.posts.values()].filter((p) => p.channel_id === id);
    const creations = posts
      .map((p) => (p.creation_id ? store.creations.get(p.creation_id) : null))
      .filter(Boolean);
    return { posts, creations };
  });

  // --- Generation (G1) ---
  app.post("/spaces/:id/generations", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      action: CreativeAction;
      prompt: string;
      plugin_id?: string;
      source_assets?: string[];
      moderation_scores?: Record<string, number>;
    };
    const result = await service.submitGeneration({
      spaceId: id,
      creatorId: actor(req),
      action: body.action,
      prompt: body.prompt,
      pluginId: body.plugin_id,
      sourceAssets: body.source_assets,
      moderationScores: body.moderation_scores,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ creation: result.creation });
  });

  app.get("/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const creation = store.creations.get(id);
    if (!creation) return reply.code(404).send({ error: "creation_not_found" });
    return { creation };
  });

  // --- Internal share (G2) ---
  app.post("/generations/:id/share", async (req, reply) => {
    const { id } = req.params as { id: string };
    const creation = service.shareInternally(id);
    if (!creation) return reply.code(404).send({ error: "creation_not_found" });
    return { creation };
  });

  // --- External export (G3) ---
  app.post("/generations/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { use_type: UseType; sale_price?: number };
    const result = service.requestExport({
      creationId: id,
      requesterId: actor(req),
      useType: body.use_type,
      salePrice: body.sale_price,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ export: result.export });
  });

  app.post("/exports/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { approve?: boolean; reason?: string };
    const result = service.decideExport({
      exportId: id,
      ownerId: actor(req),
      approve: body.approve ?? true,
      reason: body.reason,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { export: result.export };
  });

  app.post("/exports/:id/pay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = service.payAndSettle(id, actor(req));
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { export: result.export, distribution: result.distribution };
  });

  app.get("/exports", async () => ({ exports: [...store.exports.values()] }));

  // --- Consent Matrix ---
  app.get("/ip/:id/consent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ip = store.ips.get(id);
    if (!ip) return reply.code(404).send({ error: "ip_not_found" });
    return { ip_id: ip.ip_id, policy: ip.policy };
  });

  app.put("/ip/:id/consent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ip = store.ips.get(id);
    if (!ip) return reply.code(404).send({ error: "ip_not_found" });
    if (ip.owner_id !== actor(req)) return reply.code(403).send({ error: "not_ip_owner" });
    const body = req.body as Parameters<typeof revisePolicy>[1];
    ip.policy = revisePolicy(ip.policy, body ?? {});
    return { ip_id: ip.ip_id, policy: ip.policy };
  });

  // --- License Ledger ---
  app.get("/ledger", async () => ({
    entries: store.ledger.list(),
    head_hash: store.ledger.headHash,
    integrity_ok: store.ledger.verify() === -1,
  }));

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.env.RUN_SERVER === "1") {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 4000);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
