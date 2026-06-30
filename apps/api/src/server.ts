import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import { revisePolicy, type CreativeAction, type UseType } from "@remix-hub/core";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import "./auth/types.js";
import { MemoryAssetStore } from "./assets/store.js";
import { MarketService } from "./market.js";
import { PluginGateway } from "./plugins/gateway.js";
import { EventBus } from "./realtime/bus.js";
import { registerRealtime } from "./realtime/ws.js";
import { MemoryRepo, createRepo, type Repo } from "./repo/index.js";
import { RemixService } from "./service.js";

/**
 * REMIX HUB API.
 *
 * Identity comes from a JWT bearer token (see ./auth). Reads are public;
 * mutating routes require `authenticate`, and owner-only routes add RBAC.
 * The storage engine is injected as a `Repo` (memory / Postgres).
 */
export function buildServer(repo: Repo = new MemoryRepo()) {
  const bus = new EventBus();
  const gateway = PluginGateway.fromEnv();
  const assets = new MemoryAssetStore();
  const service = new RemixService(repo, gateway, bus, assets);
  const market = new MarketService(repo, assets);
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  registerAuth(app, repo);
  registerRealtime(app, bus);

  const uid = (req: { authUser?: { sub: string } }): string => req.authUser!.sub;
  const auth = () => ({ preHandler: [app.authenticate] });

  app.get("/health", async () => ({ status: "ok", service: "remix-hub-api", version: "0.1.0" }));

  // Plugin Gateway inventory (which adapters serve which capabilities).
  app.get("/plugins", async () => gateway.describe());

  // --- Spaces & channels (Community Service) — public reads ---
  app.get("/spaces", async () => ({ spaces: await repo.listSpaces() }));

  app.get("/spaces/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ctx = await repo.spaceWithIp(id);
    if (!ctx) return reply.code(404).send({ error: "space_not_found" });
    const channels = await repo.listChannels(id);
    return { space: ctx.space, ip: ctx.ip, channels };
  });

  app.get("/channels/:id/posts", async (req) => {
    const { id } = req.params as { id: string };
    const posts = await repo.listPosts(id);
    const creations = (
      await Promise.all(posts.map((p) => (p.creation_id ? repo.getCreation(p.creation_id) : null)))
    ).filter(Boolean);
    return { posts, creations };
  });

  // --- Generation (G1) — creators/owners ---
  app.post(
    "/spaces/:id/generations",
    { preHandler: [app.authenticate, app.requireRole("CREATOR", "OWNER", "ADMIN")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        action: CreativeAction;
        prompt: string;
        plugin_id?: string;
        source_assets?: string[];
        moderation_scores?: Record<string, number>;
        channel_id?: string;
      };
      const result = await service.submitGeneration({
        spaceId: id,
        creatorId: uid(req),
        action: body.action,
        prompt: body.prompt,
        pluginId: body.plugin_id,
        sourceAssets: body.source_assets,
        moderationScores: body.moderation_scores,
        channelId: body.channel_id,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.reason });
      return reply.code(201).send({ creation: result.creation });
    },
  );

  app.get("/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const creation = await repo.getCreation(id);
    if (!creation) return reply.code(404).send({ error: "creation_not_found" });
    return { creation };
  });

  // --- Internal share (G2) ---
  app.post("/generations/:id/share", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const creation = await service.shareInternally(id);
    if (!creation) return reply.code(404).send({ error: "creation_not_found" });
    return { creation };
  });

  // --- External export (G3) ---
  app.post("/generations/:id/export", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { use_type: UseType; sale_price?: number };
    const result = await service.requestExport({
      creationId: id,
      requesterId: uid(req),
      useType: body.use_type,
      salePrice: body.sale_price,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ export: result.export });
  });

  // Owner-only: approve/reject a pending export.
  app.post(
    "/exports/:id/approve",
    { preHandler: [app.authenticate, app.requireRole("OWNER", "ADMIN")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { approve?: boolean; reason?: string };
      const result = await service.decideExport({
        exportId: id,
        ownerId: uid(req),
        approve: body.approve ?? true,
        reason: body.reason,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.reason });
      return { export: result.export };
    },
  );

  app.post("/exports/:id/pay", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await service.payAndSettle(id, uid(req));
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { export: result.export, distribution: result.distribution };
  });

  app.get("/exports", async () => ({ exports: await repo.listExports() }));

  // License manifest for an export (the AI-label + provenance proof).
  app.get("/exports/:id/license", async (req, reply) => {
    const { id } = req.params as { id: string };
    const exportReq = await repo.getExport(id);
    if (!exportReq?.license_doc) return reply.code(404).send({ error: "license_not_issued" });
    const asset = await assets.get(exportReq.license_doc);
    if (!asset) return reply.code(404).send({ error: "license_not_found" });
    return { license: asset.data };
  });

  // Asset access: export-scoped assets (license proofs) are public; internal
  // assets require authentication (NFR: 자산 접근권 분리).
  app.get("/assets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await assets.get(id);
    if (!asset) return reply.code(404).send({ error: "asset_not_found" });
    if (asset.scope === "internal") {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
    return { asset };
  });

  // --- Consent Matrix ---
  app.get("/ip/:id/consent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ip = await repo.getIp(id);
    if (!ip) return reply.code(404).send({ error: "ip_not_found" });
    return { ip_id: ip.ip_id, policy: ip.policy };
  });

  // Owner-only: edit consent policy (ownership re-checked against the IP).
  app.put(
    "/ip/:id/consent",
    { preHandler: [app.authenticate, app.requireRole("OWNER", "ADMIN")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ip = await repo.getIp(id);
      if (!ip) return reply.code(404).send({ error: "ip_not_found" });
      if (ip.owner_id !== uid(req)) return reply.code(403).send({ error: "not_ip_owner" });
      const body = req.body as Parameters<typeof revisePolicy>[1];
      const policy = revisePolicy(ip.policy, body ?? {});
      await repo.setIpPolicy(id, policy);
      return { ip_id: ip.ip_id, policy };
    },
  );

  // --- Marketplace (P2) ---
  app.get("/market/listings", async () => market.catalog());

  app.post("/market/templates", auth(), async (req) => {
    const body = req.body as { title: string; body: string; ip_id?: string };
    const template = await market.createTemplate({
      authorId: uid(req),
      title: body.title,
      body: body.body,
      ipId: body.ip_id,
    });
    return { template };
  });

  app.post("/market/listings", auth(), async (req, reply) => {
    const body = req.body as {
      kind: "creation" | "template";
      ref_id: string;
      title: string;
      price: number;
      currency?: "KRW" | "USD" | "JPY" | "EUR";
    };
    const result = await market.createListing({
      sellerId: uid(req),
      kind: body.kind,
      refId: body.ref_id,
      title: body.title,
      price: body.price,
      currency: body.currency,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ listing: result.value });
  });

  app.post("/market/listings/:id/buy", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await market.purchase(id, uid(req));
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ order: result.value });
  });

  app.get("/market/orders", async () => ({ orders: await repo.listOrders() }));

  // --- License Ledger ---
  app.get("/ledger", async () => ({
    entries: await repo.listLedger(),
    head_hash: await repo.ledgerHead(),
    integrity_ok: (await repo.verifyLedger()) === -1,
  }));

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.env.RUN_SERVER === "1") {
  const port = Number(process.env.PORT ?? 4000);
  createRepo()
    .then((repo) => buildServer(repo).listen({ port, host: "0.0.0.0" }))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
