import {
  buildLicenseManifest,
  canGenerate,
  distribute,
  exportDecision,
  isLicenseExpired,
  type Creation,
  type CreativeAction,
  type ExportRequest,
  type LicenseManifest,
  type NotificationType,
  type Post,
  type UseType,
} from "@remix-hub/core";
import { MemoryAssetStore, type AssetStore } from "./assets/store.js";
import { KeywordModerator, type Moderator } from "./moderation/moderator.js";
import { NoopNotifier, type Notifier } from "./notify/notifier.js";
import { MockPaymentProvider, type PaymentProvider } from "./payments/provider.js";
import { signManifestHash } from "./provenance/sign.js";
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
    private readonly moderator: Moderator = new KeywordModerator(),
    private readonly payments: PaymentProvider = new MockPaymentProvider(),
    private readonly notifier: Notifier = new NoopNotifier(),
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
    /** Remix lineage: the creation this generation is derived from, if any. */
    parentCreationId?: string;
    /** When set, a Post is created in this channel and broadcast in real time. */
    channelId?: string;
  }): Promise<{ ok: true; creation: Creation } | { ok: false; status: number; reason: string }> {
    const ctx = await this.repo.spaceWithIp(params.spaceId);
    if (!ctx) return { ok: false, status: 404, reason: "space_not_found" };

    // Remix: a derived work must reference an existing creation of the same IP.
    if (params.parentCreationId) {
      const parent = await this.repo.getCreation(params.parentCreationId);
      if (!parent) return { ok: false, status: 404, reason: "parent_creation_not_found" };
      if (parent.ip_id !== ctx.ip.ip_id) {
        return { ok: false, status: 400, reason: "parent_ip_mismatch" };
      }
    }

    const moderation = await this.moderator.screen({
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

    // G1 passed. Create the record in "generating" state and return immediately,
    // so a "생성 중…" card appears instantly. The Plugin Gateway (Higgsfield/NIM
    // → stub) runs in the background; on completion we fill the asset and
    // broadcast creation.updated so every viewer sees it resolve live.
    const creation: Creation = {
      creation_id: newId("cr"),
      ip_id: ctx.ip.ip_id,
      creator_id: params.creatorId,
      plugin_id: params.pluginId ?? `${params.action}.pending`,
      action: params.action,
      parent_creation_id: params.parentCreationId ?? null,
      source_assets: params.sourceAssets ?? [],
      output_asset: null,
      moderation,
      provenance: { source_assets: params.sourceAssets ?? [], model_info: { plugin_id: "pending" }, prompt: params.prompt },
      status: "generating",
      created_at: now(),
    };
    await this.repo.saveCreation(creation);

    await this.repo.appendLedger({
      event_type: "create",
      actor: params.creatorId,
      payload: { result: "submitted", creation_id: creation.creation_id, ip_id: ctx.ip.ip_id, action: params.action },
    });

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

    // Fire-and-forget the actual generation.
    void this.completeGeneration(creation, {
      prompt: params.prompt,
      sourceAssets: params.sourceAssets ?? [],
      ipId: ctx.ip.ip_id,
      action: params.action,
      pluginId: params.pluginId,
      channelId: params.channelId,
      actorId: params.creatorId,
    });

    return { ok: true, creation };
  }

  /** Background: run the plugin, fill the asset, and broadcast the result. */
  private async completeGeneration(creation: Creation, p: {
    prompt: string;
    sourceAssets: string[];
    ipId: string;
    action: CreativeAction;
    pluginId?: string;
    channelId?: string;
    actorId: string;
  }): Promise<void> {
    const fresh = (await this.repo.getCreation(creation.creation_id)) ?? creation;
    try {
      const job = await this.gateway.generate({
        prompt: p.prompt,
        source_assets: p.sourceAssets,
        ip_id: p.ipId,
        action: p.action,
        preferred_plugin_id: p.pluginId,
      });
      fresh.output_asset = job.output;
      fresh.provenance = job.provenance;
      // Record the adapter that actually produced the asset (post-failover).
      fresh.plugin_id = job.plugin_id;
      fresh.status = "generated";
      await this.repo.saveCreation(fresh);
      await this.repo.appendLedger({
        event_type: "create",
        actor: p.actorId,
        payload: { result: "generated", creation_id: fresh.creation_id, ip_id: p.ipId, action: p.action },
      });
    } catch (e) {
      fresh.status = "failed";
      await this.repo.saveCreation(fresh);
      await this.repo.appendLedger({
        event_type: "create",
        actor: p.actorId,
        payload: { result: "failed", creation_id: fresh.creation_id, error: (e as Error).message },
      });
    }
    if (p.channelId) {
      this.bus?.publish({ type: "creation.updated", channel_id: p.channelId, creation: fresh });
    }
  }

  /**
   * Remix lineage (2차창작 추적): the chain of ancestors up to the root plus the
   * direct remix children of a creation. Ancestor walking is depth-capped to
   * guard against a malformed cycle.
   */
  async lineage(creationId: string): Promise<
    | {
        ok: true;
        creation: Creation;
        ancestors: Creation[];
        children: Creation[];
        depth: number;
      }
    | { ok: false; status: number; reason: string }
  > {
    const creation = await this.repo.getCreation(creationId);
    if (!creation) return { ok: false, status: 404, reason: "creation_not_found" };

    const ancestors: Creation[] = [];
    const seen = new Set<string>([creation.creation_id]);
    let cursor = creation.parent_creation_id ?? null;
    while (cursor && !seen.has(cursor) && ancestors.length < 64) {
      const parent = await this.repo.getCreation(cursor);
      if (!parent) break;
      ancestors.push(parent);
      seen.add(parent.creation_id);
      cursor = parent.parent_creation_id ?? null;
    }
    const children = await this.repo.listCreationChildren(creationId);
    // Ancestors are ordered nearest-first; depth is the distance to the root.
    return { ok: true, creation, ancestors, children, depth: ancestors.length };
  }

  /** Community chat: send a plain text message (optionally a reply) and broadcast. */
  async sendMessage(params: {
    channelId: string;
    authorId: string;
    text: string;
    replyTo?: string | null;
    imageUrl?: string | null;
  }): Promise<{ ok: true; post: Post } | { ok: false; status: number; reason: string }> {
    const text = params.text?.trim() ?? "";
    const image = params.imageUrl?.trim() || null;
    if (!text && !image) return { ok: false, status: 400, reason: "empty_message" };
    if (image && !/^https?:\/\//i.test(image)) return { ok: false, status: 400, reason: "invalid_image_url" };
    const post: Post = {
      post_id: newId("post"),
      channel_id: params.channelId,
      author_id: params.authorId,
      text,
      creation_id: null,
      reply_to: params.replyTo ?? null,
      image_url: image,
      created_at: now(),
    };
    await this.repo.createPost(post);
    const author = await this.repo.getUser(params.authorId);
    this.bus?.publish({ type: "post.created", channel_id: params.channelId, post, author });
    await this.notify(post);
    return { ok: true, post };
  }

  /** Create notifications for mentions, replies, and DMs triggered by a message. */
  private async notify(post: Post): Promise<void> {
    const text = post.text ?? "";
    const actor = post.author_id;
    const recipients = new Map<string, "mention" | "reply" | "dm">();

    if (post.channel_id.startsWith("dm_")) {
      for (const p of post.channel_id.slice(3).split("__")) {
        if (p !== actor) recipients.set(p, "dm");
      }
    } else {
      const tokens = [...text.matchAll(/@(\S+)/g)].map((m) => m[1]!);
      if (tokens.length) {
        const channel = await this.repo.getChannel(post.channel_id);
        if (channel) {
          const members = await this.repo.listMembers(channel.space_id);
          for (const t of tokens) {
            const hit = members.find((u) => u.user_id === t || u.display_name === t);
            if (hit && !recipients.has(hit.user_id)) recipients.set(hit.user_id, "mention");
          }
        }
      }
    }

    if (post.reply_to) {
      const parent = await this.repo.getPost(post.reply_to);
      if (parent && !recipients.has(parent.author_id)) recipients.set(parent.author_id, "reply");
    }

    recipients.delete(actor);
    const actorUser = recipients.size ? await this.repo.getUser(actor) : null;
    const actorName = actorUser?.display_name ?? actor;
    const LABEL: Record<"mention" | "reply" | "dm", string> = { mention: "언급", reply: "답글", dm: "DM" };
    for (const [userId, type] of recipients) {
      await this.repo.addNotification({
        notification_id: newId("ntf"),
        user_id: userId,
        type,
        actor_id: actor,
        channel_id: post.channel_id,
        post_id: post.post_id,
        text: text.slice(0, 80),
        read: false,
        created_at: now(),
      });
      // Fan out to email/push (best-effort; NoopNotifier unless configured).
      void this.notifier.send({
        kind: type,
        to: userId,
        actor,
        title: `${actorName}님의 ${LABEL[type]}`,
        body: text.slice(0, 140),
        meta: { channel_id: post.channel_id, post_id: post.post_id },
      });
    }
  }

  /**
   * Record a lifecycle event (export decision / settlement / expiry) as an
   * in-app notification. Unlike community events these have no channel/post, so
   * those references are null. Outbound (email/push) dispatch is separate.
   */
  private async recordLifecycleNotification(
    userId: string,
    type: NotificationType,
    text: string,
    actorId?: string,
  ): Promise<void> {
    await this.repo.addNotification({
      notification_id: newId("ntf"),
      user_id: userId,
      type,
      actor_id: actorId ?? userId,
      channel_id: null,
      post_id: null,
      text: text.slice(0, 120),
      read: false,
      created_at: now(),
    });
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
    /** External-brand licensing context (the marketplace's third side). */
    brand?: string;
    useCase?: string;
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
      brand: params.brand ?? null,
      use_case: params.useCase ?? null,
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
        brand: exportReq.brand,
        use_case: exportReq.use_case,
      },
    });

    return { ok: true, export: exportReq };
  }

  /**
   * Brand-licensing catalog — the marketplace's *third side*. Lists shared
   * creations an external brand could commercially license, annotated with the
   * IP name, the creator, and whether the IP's consent policy currently permits
   * commercial use (with an indicative fee). This is what makes REMIX HUB a
   * rights protocol rather than a fan storefront: buyers discover fan/AI-made
   * work and license it through the very same Rights Engine gate.
   */
  async licenseCatalog(): Promise<
    {
      creation_id: string;
      action: CreativeAction;
      ip_id: string;
      ip_name: string;
      creator_id: string;
      output_asset: string | null;
      commercial_allowed: boolean;
      indicative_fee: number | null;
    }[]
  > {
    const creations = await this.repo.listCreations();
    const catalog = [];
    for (const c of creations) {
      if (c.status !== "shared" && c.status !== "exported") continue;
      const ip = await this.repo.getIp(c.ip_id);
      if (!ip) continue;
      let commercialAllowed = false;
      let fee: number | null = null;
      try {
        const verdict = exportDecision(ip, "commercial", {});
        commercialAllowed = verdict.outcome !== "deny";
        fee = verdict.fee ?? null;
      } catch {
        commercialAllowed = false;
      }
      catalog.push({
        creation_id: c.creation_id,
        action: c.action,
        ip_id: ip.ip_id,
        ip_name: ip.name,
        creator_id: c.creator_id,
        output_asset: c.output_asset ?? null,
        commercial_allowed: commercialAllowed,
        indicative_fee: fee,
      });
    }
    return catalog;
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

    // Alert the requester of the owner's decision (in-app + email/push).
    const decisionText = params.approve
      ? `외부 반출 승인 · ${ip.name} · ${exportReq.use_type}`
      : `외부 반출 거절 · ${ip.name} · ${exportReq.use_type} (${exportReq.reject_reason})`;
    await this.recordLifecycleNotification(exportReq.requester_id, "export_decision", decisionText, params.ownerId);
    void this.notifier.send({
      kind: "export_decision",
      to: exportReq.requester_id,
      actor: params.ownerId,
      title: params.approve ? "외부 반출이 승인되었습니다" : "외부 반출이 거절되었습니다",
      body: params.approve
        ? `${ip.name} · ${exportReq.use_type} 반출이 승인되었습니다. 결제 후 라이선스가 발급됩니다.`
        : `${ip.name} · ${exportReq.use_type} 반출이 거절되었습니다. 사유: ${exportReq.reject_reason}`,
      meta: { export_id: exportReq.export_id, approval: exportReq.approval, fee_amount: exportReq.fee_amount },
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

    // Charge the fee before distributing (PRD §4.6). Mock in dev; Stripe if keyed.
    const charge = await this.payments.charge({
      amount: exportReq.fee_amount,
      currency: "KRW",
      reference: exportReq.export_id,
      description: `REMIX HUB export ${exportReq.use_type}`,
    });
    if (!charge.ok) return { ok: false, status: 402, reason: "payment_failed" };

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
    const sig = signManifestHash(manifest.manifest_hash);
    manifest.provenance_signature = sig.signature;
    manifest.signing_key_id = sig.key_id;
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
        payment_id: charge.payment_id,
        payment_provider: this.payments.id,
      },
    });

    // Notify the creator that a settlement occurred with their share.
    if (creation) {
      const settleText = `정산 완료 · ${exportReq.use_type} · 창작자 배분 ${distribution.creator.toLocaleString("ko-KR")}원`;
      await this.recordLifecycleNotification(creation.creator_id, "settlement", settleText, actorId);
      void this.notifier.send({
        kind: "settlement",
        to: creation.creator_id,
        title: "정산이 완료되었습니다",
        body: `${exportReq.use_type} 반출 정산 완료 · 창작자 배분 ${distribution.creator.toLocaleString("ko-KR")}원`,
        meta: {
          export_id: exportReq.export_id,
          fee_amount: exportReq.fee_amount,
          distribution,
          payment_id: charge.payment_id,
        },
      });
    }

    return { ok: true, export: exportReq, distribution };
  }

  /**
   * License expiry reminders: find issued licenses whose term ends within
   * `withinDays` (and hasn't already lapsed) and dispatch an outbound alert to
   * the license holder. Idempotent to call; returns what was reminded so an
   * admin/cron can report it. Perpetual licenses (valid_until = null) are skipped.
   */
  async remindExpiringLicenses(opts: { withinDays?: number; now?: string } = {}): Promise<{
    reminded: number;
    expiring: { export_id: string; requester_id: string; valid_until: string; days_left: number }[];
  }> {
    const withinDays = Math.max(1, opts.withinDays ?? 14);
    const nowISO = opts.now ?? now();
    const nowMs = new Date(nowISO).getTime();
    const horizonMs = nowMs + withinDays * 86_400_000;

    const exports = await this.repo.listExports();
    const expiring: { export_id: string; requester_id: string; valid_until: string; days_left: number }[] = [];
    for (const ex of exports) {
      if (!ex.license_doc) continue;
      const asset = await this.assets.get(ex.license_doc);
      if (!asset) continue;
      const manifest = asset.data as LicenseManifest;
      if (!manifest.valid_until || isLicenseExpired(manifest, nowISO)) continue;
      const endMs = new Date(manifest.valid_until).getTime();
      if (endMs > horizonMs) continue; // not yet within the reminder window

      const daysLeft = Math.ceil((endMs - nowMs) / 86_400_000);
      expiring.push({
        export_id: ex.export_id,
        requester_id: ex.requester_id,
        valid_until: manifest.valid_until,
        days_left: daysLeft,
      });
      const expiryText = `라이선스 만료 임박 · ${ex.use_type} · ${daysLeft}일 후(${manifest.valid_until.slice(0, 10)})`;
      await this.recordLifecycleNotification(ex.requester_id, "license_expiry", expiryText);
      void this.notifier.send({
        kind: "license_expiry",
        to: ex.requester_id,
        title: "라이선스 만료 임박",
        body: `${ex.use_type} 라이선스가 ${daysLeft}일 후(${manifest.valid_until.slice(0, 10)}) 만료됩니다. 갱신을 검토하세요.`,
        meta: { export_id: ex.export_id, valid_until: manifest.valid_until, days_left: daysLeft },
      });
    }
    return { reminded: expiring.length, expiring };
  }
}
