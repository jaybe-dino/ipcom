import {
  canGenerate,
  distribute,
  exportDecision,
  screenHardLimits,
  type Creation,
  type CreativeAction,
  type ExportRequest,
  type IP,
  type UseType,
} from "@remix-hub/core";
import { newId, now } from "./ids.js";
import { PluginGateway } from "./plugins/gateway.js";
import type { Store } from "./store.js";

/**
 * Application service tying @remix-hub/core gates to the store and ledger.
 * This is where the PRD §2.2 data flow lives: every generation and export
 * passes through moderation → rights → plugin → watermark/ledger in one place.
 */
export class RemixService {
  constructor(
    private readonly store: Store,
    private readonly gateway: PluginGateway = PluginGateway.fromEnv(),
  ) {}

  /** PRD §2.2 + G1: submit a generation job, then dispatch to the Plugin Gateway. */
  async submitGeneration(params: {
    spaceId: string;
    creatorId: string;
    action: CreativeAction;
    prompt: string;
    pluginId?: string;
    sourceAssets?: string[];
    /** Optional externally-computed moderation scores from the plugin gateway. */
    moderationScores?: Record<string, number>;
  }): Promise<{ ok: true; creation: Creation } | { ok: false; status: number; reason: string }> {
    const ctx = this.store.spaceWithIp(params.spaceId);
    if (!ctx) return { ok: false, status: 404, reason: "space_not_found" };

    const moderation = screenHardLimits({
      prompt: params.prompt,
      source_assets: params.sourceAssets,
      scores: params.moderationScores,
    });

    const verdict = canGenerate(ctx.ip, params.action, moderation);
    if (verdict.decision === "DENY") {
      // Record the refusal for auditability (PRD §4.4).
      this.store.ledger.append({
        entry_id: newId("led"),
        event_type: "create",
        actor: params.creatorId,
        payload: { result: "denied", reason: verdict.reason, ip_id: ctx.ip.ip_id, action: params.action },
        timestamp: now(),
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
      output_asset: job.output, // produced by the plugin, carries provenance
      moderation,
      provenance: job.provenance,
      status: "generated",
      created_at: now(),
    };
    this.store.creations.set(creation.creation_id, creation);

    this.store.ledger.append({
      entry_id: newId("led"),
      event_type: "create",
      actor: params.creatorId,
      payload: { result: "generated", creation_id: creation.creation_id, ip_id: ctx.ip.ip_id, action: params.action },
      timestamp: now(),
    });

    return { ok: true, creation };
  }

  /** G2: internal share — always free for space members. */
  shareInternally(creationId: string): Creation | null {
    const creation = this.store.creations.get(creationId);
    if (!creation) return null;
    creation.status = "shared";
    return creation;
  }

  /** G3: request an external export; computes policy + fee + split snapshot. */
  requestExport(params: {
    creationId: string;
    requesterId: string;
    useType: UseType;
    salePrice?: number;
  }):
    | { ok: true; export: ExportRequest }
    | { ok: false; status: number; reason: string } {
    const creation = this.store.creations.get(params.creationId);
    if (!creation) return { ok: false, status: 404, reason: "creation_not_found" };
    const ip = this.store.ips.get(creation.ip_id);
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
    this.store.exports.set(exportReq.export_id, exportReq);
    creation.status = "export_requested";

    this.store.ledger.append({
      entry_id: newId("led"),
      event_type: "export",
      actor: params.requesterId,
      payload: {
        export_id: exportReq.export_id,
        creation_id: creation.creation_id,
        use_type: params.useType,
        approval: exportReq.approval,
        fee_amount: exportReq.fee_amount,
      },
      timestamp: now(),
    });

    return { ok: true, export: exportReq };
  }

  /** IP owner approves or rejects a pending export request. */
  decideExport(params: {
    exportId: string;
    ownerId: string;
    approve: boolean;
    reason?: string;
  }): { ok: true; export: ExportRequest } | { ok: false; status: number; reason: string } {
    const exportReq = this.store.exports.get(params.exportId);
    if (!exportReq) return { ok: false, status: 404, reason: "export_not_found" };
    if (exportReq.approval !== "pending") {
      return { ok: false, status: 409, reason: "export_not_pending" };
    }
    const creation = this.store.creations.get(exportReq.creation_id);
    const ip = creation ? this.store.ips.get(creation.ip_id) : undefined;
    if (!ip || ip.owner_id !== params.ownerId) {
      return { ok: false, status: 403, reason: "not_ip_owner" };
    }

    exportReq.approval = params.approve ? "approved" : "rejected";
    exportReq.decided_at = now();
    if (!params.approve) exportReq.reject_reason = params.reason ?? "rejected_by_owner";

    this.store.ledger.append({
      entry_id: newId("led"),
      event_type: "export",
      actor: params.ownerId,
      payload: { export_id: exportReq.export_id, decision: exportReq.approval },
      timestamp: now(),
    });

    return { ok: true, export: exportReq };
  }

  /** Trigger payment + settlement for an approved/auto export, issuing a license. */
  payAndSettle(
    exportId: string,
    actorId: string,
  ): { ok: true; export: ExportRequest; distribution: ReturnType<typeof distribute> } | { ok: false; status: number; reason: string } {
    const exportReq = this.store.exports.get(exportId);
    if (!exportReq) return { ok: false, status: 404, reason: "export_not_found" };
    if (exportReq.approval !== "approved" && exportReq.approval !== "auto") {
      return { ok: false, status: 409, reason: "export_not_approved" };
    }

    const distribution = distribute(exportReq.fee_amount, exportReq.split_snapshot);
    exportReq.license_doc = newId("lic");
    const creation = this.store.creations.get(exportReq.creation_id);
    if (creation) creation.status = "exported";

    this.store.ledger.append({
      entry_id: newId("led"),
      event_type: "settle",
      actor: actorId,
      payload: {
        export_id: exportReq.export_id,
        license_doc: exportReq.license_doc,
        fee_amount: exportReq.fee_amount,
        distribution,
      },
      timestamp: now(),
    });

    return { ok: true, export: exportReq, distribution };
  }
}
