import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { revisePolicy, verifyManifest, type CreativeAction, type UseType } from "@remix-hub/core";
import { verifyManifestSignature } from "./provenance/sign.js";
import Fastify from "fastify";
import { registerAuth } from "./auth/plugin.js";
import "./auth/types.js";
import type { LicenseManifest } from "@remix-hub/core";
import { assetStoreFromEnv } from "./assets/store.js";
import { embedWatermark, extractWatermark } from "./assets/watermark.js";
import { CommunityService } from "./community.js";
import { MarketService } from "./market.js";
import { registerObservability } from "./http/observability.js";
import { moderatorFromEnv } from "./moderation/moderator.js";
import { ModerationService } from "./moderation/service.js";
import { paymentProviderFromEnv } from "./payments/provider.js";
import { SearchService } from "./search.js";
import { PluginGateway } from "./plugins/gateway.js";
import { renderShareCard, renderSharePage } from "./share.js";
import { EventBus } from "./realtime/bus.js";
import { PresenceTracker } from "./realtime/presence.js";
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
  const presence = new PresenceTracker();
  const gateway = PluginGateway.fromEnv();
  const assets = assetStoreFromEnv();
  const moderator = moderatorFromEnv();
  const payments = paymentProviderFromEnv();
  const service = new RemixService(repo, gateway, bus, assets, moderator, payments);
  const market = new MarketService(repo, assets, payments);
  const community = new CommunityService(repo);
  const moderation = new ModerationService(repo);
  const search = new SearchService(repo);
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  registerObservability(app);
  registerAuth(app, repo);
  registerRealtime(app, bus, presence);

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

  // Create a space (+ IP + default channels + creator membership).
  app.post("/spaces", auth(), async (req, reply) => {
    const body = req.body as { name: string };
    const result = await community.createSpace({ ownerId: uid(req), name: body.name });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ space: result.value });
  });

  // Create a channel in a space (members only).
  app.post("/spaces/:id/channels", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name: string; type?: "creation" | "community" | "market"; topic?: string };
    const result = await community.createChannel({
      spaceId: id,
      userId: uid(req),
      name: body.name,
      type: body.type,
      topic: body.topic,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ channel: result.value });
  });

  app.post("/spaces/:id/join", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await community.join(id, uid(req));
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { space: result.value };
  });

  app.post("/spaces/:id/leave", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    await community.leave(id, uid(req));
    return { left: true };
  });

  app.get("/spaces/:id/members", async (req) => {
    const { id } = req.params as { id: string };
    const members = await community.members(id);
    return {
      members: members.map((u) => ({
        user_id: u.user_id,
        display_name: u.display_name,
        role: u.role,
        online: presence.isOnline(u.user_id),
      })),
    };
  });

  app.get("/me/spaces", auth(), async (req) => ({ spaces: await community.mySpaces(uid(req)) }));

  // Cross-entity search (spaces / users / listings)
  app.get("/search", auth(), async (req) => {
    const { q } = req.query as { q?: string };
    return search.search(q ?? "");
  });

  // --- Direct messages (1:1) ---
  app.post("/dm/:userId", auth(), async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const result = await community.openDm(uid(req), userId);
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send(result.value);
  });

  app.get("/me/dms", auth(), async (req) => ({ dms: await community.listDms(uid(req)) }));

  // --- Notifications ---
  app.get("/me/notifications", auth(), async (req) => ({
    notifications: await repo.listNotifications(uid(req), 30),
    unread: await repo.unreadCount(uid(req)),
  }));
  app.get("/me/notifications/unread_count", auth(), async (req) => ({
    count: await repo.unreadCount(uid(req)),
  }));
  app.post("/me/notifications/read", auth(), async (req) => {
    await repo.markNotificationsRead(uid(req));
    return { ok: true };
  });

  app.get("/channels/:id/posts", async (req, reply) => {
    const { id } = req.params as { id: string };
    // DM channels are private: only the two participants may read.
    if (id.startsWith("dm_")) {
      let viewer: string | undefined;
      try {
        viewer = (await req.jwtVerify<{ sub: string }>()).sub;
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (!CommunityService.isDmParticipant(id, viewer)) {
        return reply.code(403).send({ error: "not_a_participant" });
      }
    }
    const q = req.query as { limit?: string; before?: string };
    const { posts, hasMore } = await repo.listPosts(id, {
      limit: q.limit ? Number(q.limit) : undefined,
      before: q.before,
    });
    const creations = (
      await Promise.all(posts.map((p) => (p.creation_id ? repo.getCreation(p.creation_id) : null)))
    ).filter(Boolean);
    // Author directory so the chat can show real display names.
    const authorIds = [...new Set(posts.map((p) => p.author_id))];
    const authorList = (await Promise.all(authorIds.map((aid) => repo.getUser(aid)))).filter(Boolean);
    const authors = Object.fromEntries(
      authorList.map((u) => [u!.user_id, { user_id: u!.user_id, display_name: u!.display_name, role: u!.role }]),
    );
    // Reactions (mark the viewer's own if a valid token is present).
    let viewerId: string | undefined;
    try {
      viewerId = (await req.jwtVerify<{ sub: string }>()).sub;
    } catch {
      viewerId = undefined;
    }
    const reactions = await service.reactionsFor(
      posts.map((p) => p.post_id),
      viewerId,
    );
    return { posts, creations, authors, reactions, hasMore };
  });

  // Community chat: post a text message (optionally a reply); broadcast live.
  app.post("/channels/:id/messages", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    // DM channels: only participants may post.
    if (id.startsWith("dm_") && !CommunityService.isDmParticipant(id, uid(req))) {
      return reply.code(403).send({ error: "not_a_participant" });
    }
    const body = req.body as { text: string; reply_to?: string; image_url?: string };
    const result = await service.sendMessage({
      channelId: id,
      authorId: uid(req),
      text: body.text,
      replyTo: body.reply_to,
      imageUrl: body.image_url,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ post: result.post });
  });

  // Edit / delete a message (author only).
  app.patch("/posts/:id", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { text: string };
    const result = await service.editMessage({ postId: id, userId: uid(req), text: body.text });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { post: result.post };
  });

  app.delete("/posts/:id", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await service.deleteMessage({ postId: id, userId: uid(req) });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { deleted: true };
  });

  // Typing indicator (ephemeral, broadcast only).
  app.post("/channels/:id/typing", auth(), async (req) => {
    const { id } = req.params as { id: string };
    const u = await repo.getUser(uid(req));
    bus.publish({
      type: "typing.updated",
      channel_id: id,
      user_id: uid(req),
      display_name: u?.display_name ?? uid(req),
    });
    return { ok: true };
  });

  // Toggle an emoji reaction on a post.
  app.post("/posts/:id/reactions", auth(), async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { emoji: string };
    const result = await service.reactToPost({ postId: id, userId: uid(req), emoji: body.emoji });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return { added: result.added };
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

  // --- Pixel watermark (real PNG steganography) ---
  // Embed an invisible provenance mark into a creator's PNG, and verify it back.
  // Larger body limit (8 MB) since payloads are base64-encoded images.
  const wmOpts = { ...auth(), bodyLimit: 8 * 1024 * 1024 };
  app.post("/provenance/watermark", wmOpts, async (req, reply) => {
    const body = req.body as { png_base64?: string; payload?: string };
    if (!body?.png_base64 || !body?.payload) {
      return reply.code(400).send({ error: "png_base64_and_payload_required" });
    }
    try {
      const png = Buffer.from(body.png_base64, "base64");
      const marked = embedWatermark(png, body.payload);
      return { png_base64: marked.toString("base64") };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post("/provenance/watermark/verify", wmOpts, async (req, reply) => {
    const body = req.body as { png_base64?: string };
    if (!body?.png_base64) return reply.code(400).send({ error: "png_base64_required" });
    try {
      const payload = extractWatermark(Buffer.from(body.png_base64, "base64"));
      return { watermarked: payload !== null, payload };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
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

  // Verify a license: manifest seal + detached provenance signature (public).
  app.get("/exports/:id/verify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const exportReq = await repo.getExport(id);
    const asset = exportReq?.license_doc ? await assets.get(exportReq.license_doc) : null;
    if (!asset) return reply.code(404).send({ error: "license_not_found" });
    const manifest = asset.data as LicenseManifest;
    const manifest_ok = verifyManifest(manifest);
    const signature_ok = manifest.provenance_signature
      ? verifyManifestSignature(manifest.manifest_hash, manifest.provenance_signature)
      : false;
    return { manifest_ok, signature_ok, signing_key_id: manifest.signing_key_id ?? null };
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

  // --- Public share (external platforms: OG/Twitter rich previews) ---
  const absoluteBase = (req: { headers: Record<string, unknown> }): string => {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || "https";
    const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
    return `${proto}://${host}`;
  };

  async function loadShare(id: string) {
    const ex = await repo.getExport(id);
    if (!ex?.license_doc) return null;
    const asset = await assets.get(ex.license_doc);
    if (!asset) return null;
    const creation = await repo.getCreation(ex.creation_id);
    return { manifest: asset.data as LicenseManifest, creation };
  }

  app.get("/share/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await loadShare(id);
    if (!data) return reply.code(404).type("text/html").send("<h1>공유할 수 없는 항목입니다</h1>");
    const base = absoluteBase(req);
    return reply
      .type("text/html")
      .send(renderSharePage(data.manifest, data.creation, { baseUrl: base, exportId: id, appUrl: base }));
  });

  app.get("/share/:id/card.svg", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await loadShare(id);
    if (!data) return reply.code(404).send("not found");
    return reply.type("image/svg+xml").send(renderShareCard(data.manifest, data.creation));
  });

  // --- Moderation reports (PRD §4.4) ---
  app.post("/reports", auth(), async (req, reply) => {
    const body = req.body as { target_type: "creation" | "post" | "space"; target_id: string; reason: string };
    const result = await moderation.report({
      reporterId: uid(req),
      targetType: body.target_type,
      targetId: body.target_id,
      reason: body.reason,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.reason });
    return reply.code(201).send({ report: result.value });
  });

  app.get(
    "/admin/reports",
    { preHandler: [app.authenticate, app.requireRole("ADMIN", "OWNER")] },
    async (req) => {
      const { status } = req.query as { status?: "open" | "actioned" | "dismissed" };
      return { reports: await moderation.list(status) };
    },
  );

  app.post(
    "/admin/reports/:id/resolve",
    { preHandler: [app.authenticate, app.requireRole("ADMIN", "OWNER")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { action: "actioned" | "dismissed"; note?: string };
      const result = await moderation.resolve({
        reportId: id,
        resolverId: uid(req),
        action: body.action,
        note: body.note,
      });
      if (!result.ok) return reply.code(result.status).send({ error: result.reason });
      return { report: result.value };
    },
  );

  // --- License Ledger ---
  app.get("/ledger", async () => ({
    entries: await repo.listLedger(),
    head_hash: await repo.ledgerHead(),
    integrity_ok: (await repo.verifyLedger()) === -1,
  }));

  // --- Static web (single-service deploy) ---
  // When the built web app is present, serve it from the same origin so one
  // service hosts the whole site. The web build must target same-origin
  // (VITE_API_BASE=""), so its /spaces, /ws/... calls hit these routes.
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : resolve(here, "../../web/dist");
  if (existsSync(join(webDist, "index.html"))) {
    app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback: serve index.html for unmatched GET navigations.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/ws")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
    app.log.info(`serving web from ${webDist}`);
  }

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
