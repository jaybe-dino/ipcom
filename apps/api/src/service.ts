import {
  buildLicenseManifest,
  canGenerate,
  distribute,
  exportDecision,
  screenHardLimits,
  type Creation,
  type CreativeAction,
  type ExportRequest,
  type Post,
  type UseType,
} from "@remix-hub/core";
import { MemoryAssetStore, type AssetStore } from "./assets/store.js";
import { newId, now } from "./ids.js";
import { PluginGateway } from "./plugins/gateway.js";
import type { EventBus } from "./realtime/bus.js";
import type { Repo } from "./repo/types.js";

/**
 * Application service tying @remix-hub/core gates to the repository and ledger.
 * This is where the PRD §2.2 data flow lives: every generation and export
 * passes through moderation → rights → plugin → watermark/ledger in one place.
 */
export class RemixService {
  constructor(
    private readonly repo: Repo,
    private readonly gateway: PluginGateway = PluginGateway.fromEnv(),
    private readonly bus?: EventBus,
    private readonly assets: AssetStore = new MemoryAssetStore(),
  ) {}

  /** PRD §2.2 + G1: submit a generation job, then dispatch to the Plugin Gateway. */
  async submitGeneration(params: {
    spaceId: string;
    creatorId: string;
    action: CreativeAction;
    prompt: string;
    pluginId?: string;
    sourceAssets?: string[];
    moderationScores?: Record<string, number>;
    /** When set, a Post is created in this channel and broadcast in real time. */
    channelId?: string;
  }): Promise<{ ok: true; creation: Creation } | { ok: false; status: number; reason: string }> {
    const ctx = await this.repo.spaceWithIp(params.spaceId);
    if (!ctx) return { ok: false, status: 404, reason: "space_not_found" };

    const moderation = screenHardLimits({
      prompt: params.prompt,
      source_assets: params.sourceAssets,
      scores: params.moderationScores,
    });

    const verdict = canGenerate(ctx.ip, params.action, moderation);
    if (verdict.decision === "DENY") {
      await this.repo.appendLedger({
        event_type: "create",
        actor: params.creatorId,
        payload: { result: "denied", reason: verdict.reason, ip_id: ctx.ip.ip_id, action: params.action },
      });
      return { ok: false, status: 403, reason: verdict.reason ?? "denied" };
    }

    // Dispatch to the Plugin Gateway (NVIDIA NIM → stub failover). The gate has
    // already passed, so the engine only ever runs on permitted requests.
    const job = await this.gateway.generate({
      prompt: params.prompt,
      source_assets: params.sourceAssets ?? [],
      ip_id: ctx.ip.ip_id,
      action: params.action,
    });

    const creation: Creation = {
      creation_id: newId("cr"),
      ip_id: ctx.ip.ip_id,
      creator_id: params.creatorId,
      plugin_id: params.pluginId ?? job.plugin_id,
      action: params.action,
      source_assets: params.sourceAssets ?? [],
      output_asset: job.output,
      moderation,
      provenance: job.provenance,
      status: "generated",
      created_at: now(),
    };
    await this.repo.saveCreation(creation);

    await this.repo.appendLedger({
      event_type: "create",
      actor: params.creatorId,
      payload: { result: "generated", creation_id: creation.creation_id, ip_id: ctx.ip.ip_id, action: params.action },
    });

    // Post the creation into the channel + broadcast to live subscribers.
    if (params.channelId) {
      const post = {
        post_id: newId("post"),
        channel_id: params.channelId,
        author_id: params.creatorId,
        text: params.prompt,
        creation_id: creation.creation_id,
        created_at: now(),
      };
      await this.repo.createPost(post);
      const author = await this.repo.getUser(params.creatorId);
      this.bus?.publish({ type: "post.created", channel_id: params.channelId, post, creation, author });
    }

    return { ok: true, creation };
  }

  /** Community chat: send a plain text message (optionally a reply) and broadcast. */
  async sendMessage(params: {
    channelId: string;
    authorId: string;
    text: string;
    replyTo?: string | null;
  }): Promise<{ ok: true; post: Post } | { ok: false; status: number; reason: string }> {
    const text = params.text?.trim();
    if (!text) return { ok: false, status: 400, reason: "empty_message" };
    const post: Post = {
      post_id: newId("post"),
      channel_id: params.channelId,
      author_id: params.authorId,
      text,
      creation_id: null,
      reply_to: params.replyTo ?? null,
      created_at: now(),
    };
    await this.repo.createPost(post);
    const author = await this.repo.getUser(params.authorId);
    this.bus?.publish({ type: "post.created", channel_id: params.channelId, post, author });
    return { ok: true, post };
  }

  /** Edit a message (author only). */
  async editMessage(params: {
    postId: string;
    userId: string;
    text: string;
  }): Promise<{ ok: true; post: Post } | { ok: false; status: number; reason: string }> {
    const text = params.text?.trim();
    if (!text) return { ok: false, status: 400, reason: "empty_message" };
    const post = await this.repo.getPost(params.postId);
    if (!post) return { ok: false, status: 404, reason: "post_not_found" };
    if (post.author_id !== params.userId) return { ok: false, status: 403, reason: "not_author" };
    const editedAt = now();
    await this.repo.updatePostText(params.postId, text, editedAt);
    const updated = { ...post, text, edited_at: editedAt };
    this.bus?.publish({
      type: "post.updated",
      channel_id: post.channel_id,
      post_id: post.post_id,
      text,
      edited_at: editedAt,
    });
    return { ok: true, post: updated };
  }

  /** Delete a message (author only). */
  async deleteMessage(params: {
    postId: string;
    userId: string;
  }): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
    const post = await this.repo.getPost(params.postId);
    if (!post) return { ok: false, status: 404, reason: "post_not_found" };
    if (post.author_id !== params.userId) return { ok: false, status: 403, reason: "not_author" };
    await this.repo.deletePost(params.postId);
    this.bus?.publish({ type: "post.deleted", channel_id: post.channel_id, post_id: post.post_id });
    return { ok: true };
  }

  /** Toggle an emoji reaction on a post and broadcast the change. */
  async reactToPost(params: {
    postId: string;
    userId: string;
    emoji: string;
  }): Promise<{ ok: true; added: boolean } | { ok: false; status: number; reason: string }> {
    const emoji = params.emoji?.trim();
    if (!emoji) return { ok: false, status: 400, reason: "emoji_required" };
    const post = await this.repo.getPost(params.postId);
    if (!post) return { ok: false, status: 404, reason: "post_not_found" };
    const { added } = await this.repo.toggleReaction({
      post_id: params.postId,
      user_id: params.userId,
      emoji,
      created_at: now(),
    });
    this.bus?.publish({
      type: "reaction.updated",
      channel_id: post.channel_id,
      post_id: params.postId,
      user_id: params.userId,
      emoji,
      added,
    });
    return { ok: true, added };
  }

  /** Aggregate reactions for a set of posts, marking the viewer's own. */
  async reactionsFor(
    postIds: string[],
    viewerId?: string,
  ): Promise<Record<string, { emoji: string; count: number; mine: boolean }[]>> {
    const all = await this.repo.listReactions(postIds);
    const byPost: Record<string, Map<string, { count: number; mine: boolean }>> = {};
    for (const r of all) {
      const m = (byPost[r.post_id] ??= new Map());
      const cur = m.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (viewerId && r.user_id === viewerId) cur.mine = true;
      m.set(r.emoji, cur);
    }
    const out: Record<string, { emoji: string; count: number; mine: boolean }[]> = {};
    for (const [postId, m] of Object.entries(byPost)) {
      out[postId] = [...m.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }));
    }
    return out;
  }

  /** G2: internal share — always free for space members. */
  async shareInternally(creationId: string): Promise<Creation | null> {
    const creation = await this.repo.getCreation(creationId);
    if (!creation) return null;
    creation.status = "shared";
    await this.repo.saveCreation(creation);
    return creation;
  }

  /** G3: request an external export; computes policy + fee + split snapshot. */
  async requestExport(params: {
    creationId: string;
    requesterId: string;
    useType: UseType;
    salePrice?: number;
  }): Promise<
    { ok: true; export: ExportRequest } | { ok: false; status: number; reason: string }
  > {
    const creation = await this.repo.getCreation(params.creationId);
    if (!creation) return { ok: false, status: 404, reason: "creation_not_found" };
    const ip = await this.repo.getIp(creation.ip_id);
    if (!ip) return { ok: false, status: 404, reason: "ip_not_found" };

    let verdict;
    try {
      verdict = exportDecision(ip, params.useType, { sale_price: params.salePrice });
    } catch (e) {
      return { ok: false, status: 400, reason: (e as Error).message };
    }

    if (verdict.outcome === "deny") {
      return { ok: false, status: 403, reason: "export_denied_by_policy" };
    }

    const split = verdict.split!;
    const exportReq: ExportRequest = {
      export_id: newId("exp"),
      creation_id: creation.creation_id,
      requester_id: params.requesterId,
      use_type: params.useType,
      approval: verdict.outcome === "auto" ? "auto" : "pending",
      fee_amount: verdict.fee,
      split_snapshot: { owner: split.owner, creator: split.creator, platform: split.platform },
      license_doc: null,
      visible_label: verdict.visible_label,
      created_at: now(),
      decided_at: verdict.outcome === "auto" ? now() : null,
    };
    await this.repo.saveExport(exportReq);
    creation.status = "export_requested";
    await this.repo.saveCreation(creation);

    await this.repo.appendLedger({
      event_type: "export",
      actor: params.requesterId,
      payload: {
        export_id: exportReq.export_id,
        creation_id: creation.creation_id,
        use_type: params.useType,
        approval: exportReq.approval,
        fee_amount: exportReq.fee_amount,
      },
    });

    return { ok: true, export: exportReq };
  }

  /** IP owner approves or rejects a pending export request. */
  async decideExport(params: {
    exportId: string;
    ownerId: string;
    approve: boolean;
    reason?: string;
  }): Promise<
    { ok: true; export: ExportRequest } | { ok: false; status: number; reason: string }
  > {
    const exportReq = await this.repo.getExport(params.exportId);
    if (!exportReq) return { ok: false, status: 404, reason: "export_not_found" };
    if (exportReq.approval !== "pending") {
      return { ok: false, status: 409, reason: "export_not_pending" };
    }
    const creation = await this.repo.getCreation(exportReq.creation_id);
    const ip = creation ? await this.repo.getIp(creation.ip_id) : null;
    if (!ip || ip.owner_id !== params.ownerId) {
      return { ok: false, status: 403, reason: "not_ip_owner" };
    }

    exportReq.approval = params.approve ? "approved" : "rejected";
    exportReq.decided_at = now();
    if (!params.approve) exportReq.reject_reason = params.reason ?? "rejected_by_owner";
    await this.repo.saveExport(exportReq);

    await this.repo.appendLedger({
      event_type: "export",
      actor: params.ownerId,
      payload: { export_id: exportReq.export_id, decision: exportReq.approval },
    });

    return { ok: true, export: exportReq };
  }

  /** Trigger payment + settlement for an approved/auto export, issuing a license. */
  async payAndSettle(
    exportId: string,
    actorId: string,
  ): Promise<
    | { ok: true; export: ExportRequest; distribution: ReturnType<typeof distribute> }
    | { ok: false; status: number; reason: string }
  > {
    const exportReq = await this.repo.getExport(exportId);
    if (!exportReq) return { ok: false, status: 404, reason: "export_not_found" };
    if (exportReq.approval !== "approved" && exportReq.approval !== "auto") {
      return { ok: false, status: 409, reason: "export_not_approved" };
    }

    const distribution = distribute(exportReq.fee_amount, exportReq.split_snapshot);
    const creation = await this.repo.getCreation(exportReq.creation_id);
    const ip = creation ? await this.repo.getIp(creation.ip_id) : null;

    // Build the sealed license manifest (visible AI label + provenance + split)
    // and store it as an export-scoped asset — this IS the license proof.
    const manifest = buildLicenseManifest({
      export_id: exportReq.export_id,
      creation_id: exportReq.creation_id,
      ip_id: ip?.ip_id ?? creation?.ip_id ?? "unknown",
      ip_name: ip?.name ?? "unknown",
      creator_id: creation?.creator_id ?? exportReq.requester_id,
      use_type: exportReq.use_type,
      plugin_id: creation?.plugin_id ?? "unknown",
      model: creation?.provenance?.model_info.model,
      prompt: creation?.provenance?.prompt ?? "",
      fee_amount: exportReq.fee_amount,
      distribution,
      issued_at: now(),
    });
    exportReq.license_doc = await this.assets.put({
      scope: "export",
      content_type: "application/vnd.remixhub.license+json",
      data: manifest,
    });
    await this.repo.saveExport(exportReq);

    if (creation) {
      creation.status = "exported";
      await this.repo.saveCreation(creation);
    }

    await this.repo.appendLedger({
      event_type: "settle",
      actor: actorId,
      payload: {
        export_id: exportReq.export_id,
        license_doc: exportReq.license_doc,
        manifest_hash: manifest.manifest_hash,
        fee_amount: exportReq.fee_amount,
        distribution,
      },
    });

    return { ok: true, export: exportReq, distribution };
  }
}
