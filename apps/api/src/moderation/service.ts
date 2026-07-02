import type { Report, ReportStatus, ReportTargetType } from "@remix-hub/core";
import { newId, now } from "../ids.js";
import type { Repo } from "../repo/types.js";

type Result<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

/**
 * Post-hoc moderation queue (PRD §4.4): users file reports; moderators review
 * and action or dismiss them. Complements the pre-generation Hard Limit screen.
 */
export class ModerationService {
  constructor(private readonly repo: Repo) {}

  async report(params: {
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reason: string;
  }): Promise<Result<Report>> {
    if (!params.reason?.trim()) return { ok: false, status: 400, reason: "reason_required" };
    const report: Report = {
      report_id: newId("rep"),
      target_type: params.targetType,
      target_id: params.targetId,
      reporter_id: params.reporterId,
      reason: params.reason.trim(),
      status: "open",
      created_at: now(),
      resolved_at: null,
      resolver_id: null,
      note: null,
    };
    await this.repo.saveReport(report);
    await this.repo.appendLedger({
      event_type: "adjust",
      actor: params.reporterId,
      payload: { kind: "report", report_id: report.report_id, target: `${params.targetType}:${params.targetId}` },
    });
    return { ok: true, value: report };
  }

  async list(status?: ReportStatus): Promise<Report[]> {
    return this.repo.listReports(status);
  }

  async resolve(params: {
    reportId: string;
    resolverId: string;
    action: "actioned" | "dismissed";
    note?: string;
  }): Promise<Result<Report>> {
    const report = await this.repo.getReport(params.reportId);
    if (!report) return { ok: false, status: 404, reason: "report_not_found" };
    report.status = params.action;
    report.resolved_at = now();
    report.resolver_id = params.resolverId;
    report.note = params.note ?? null;
    await this.repo.saveReport(report);
    await this.repo.appendLedger({
      event_type: "adjust",
      actor: params.resolverId,
      payload: { kind: "report_resolved", report_id: report.report_id, action: params.action },
    });
    return { ok: true, value: report };
  }
}
