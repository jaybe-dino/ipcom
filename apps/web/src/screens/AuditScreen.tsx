import type { LedgerEntry, Report } from "@remix-hub/client-core";
import { useMemo, useState } from "react";
import { ApiError, api, apiUrl } from "../api.js";
import { krw, useAsync } from "../useAsync.js";

type EventFilter = "all" | LedgerEntry["event_type"];

const EVENT_TABS: { id: EventFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "create", label: "생성" },
  { id: "export", label: "반출" },
  { id: "settle", label: "정산" },
  { id: "adjust", label: "조정" },
];

/** Admin audit console: license-ledger integrity + event trail + report queue. */
export function AuditScreen() {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const ledger = useAsync(() => api.getLedger(), []);
  const reports = useAsync(() => api.adminReports("open"), [refresh]);
  const coupons = useAsync(() => api.listCoupons(), [refresh]);

  const [cCode, setCCode] = useState("");
  const [cKind, setCKind] = useState<"percent" | "fixed">("percent");
  const [cValue, setCValue] = useState("");

  async function createCoupon() {
    const code = cCode.trim();
    const raw = Number(cValue);
    if (!code || !raw) return setMsg("쿠폰 코드와 값을 입력하세요.");
    // percent field is entered as a whole number (20 → 0.2).
    const value = cKind === "percent" ? raw / 100 : raw;
    try {
      const { coupon } = await api.createCoupon({ code, kind: cKind, value });
      setMsg(`쿠폰 ${coupon.code} 발급 완료.`);
      setCCode("");
      setCValue("");
      setRefresh((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "쿠폰 발급에 실패했습니다.");
    }
  }

  const entries = ledger.data?.entries ?? [];
  const filtered = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.event_type === filter)),
    [entries, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.event_type] = (c[e.event_type] ?? 0) + 1;
    return c;
  }, [entries]);

  async function resolve(id: string, status: "actioned" | "dismissed") {
    try {
      await api.resolveReport(id, { action: status });
      setMsg(status === "actioned" ? "신고를 조치했습니다." : "신고를 기각했습니다.");
      setRefresh((n) => n + 1);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "처리에 실패했습니다.");
    }
  }

  async function runExpiryReminders() {
    try {
      const { reminded } = await api.remindExpiringLicenses(30);
      setMsg(
        reminded > 0
          ? `30일 내 만료 라이선스 ${reminded}건에 만료 알림을 발송했습니다.`
          : "30일 내 만료 예정인 라이선스가 없습니다.",
      );
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "만료 알림 발송에 실패했습니다.");
    }
  }

  return (
    <section>
      <div className="scr-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2>감사 콘솔</h2>
          <p>라이선스 원장의 무결성과 전체 이벤트 이력, 그리고 신고 검토 큐를 관리자에게 제공합니다.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn gho" href={apiUrl("/ledger.csv")} download>
            ⬇ 원장 CSV
          </a>
          <button className="btn pri" onClick={runExpiryReminders}>
            ⏰ 만료 알림 발송
          </button>
        </div>
      </div>

      {msg && <div className="banner ok">{msg}</div>}

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="box">
          <p>원장 무결성</p>
          <h3 style={{ fontSize: 20, marginTop: 4 }}>
            <span className={`pill ${ledger.data?.integrity_ok ? "g" : "d"}`}>
              {ledger.loading ? "확인 중…" : ledger.data?.integrity_ok ? "✅ 정상" : "⚠️ 손상"}
            </span>
          </h3>
          <div className="hint" style={{ marginTop: 6, fontFamily: "monospace", fontSize: 10.5 }}>
            head: {ledger.data?.head_hash?.slice(0, 20) ?? "…"}…
          </div>
        </div>
        <div className="box">
          <p>총 이벤트</p>
          <h3 style={{ fontSize: 24, marginTop: 4 }}>{entries.length}</h3>
          <div className="hint" style={{ marginTop: 6 }}>
            생성 {counts.create ?? 0} · 반출 {counts.export ?? 0} · 정산 {counts.settle ?? 0}
          </div>
        </div>
        <div className="box">
          <p>미처리 신고</p>
          <h3 style={{ fontSize: 24, marginTop: 4 }}>{reports.data?.reports.length ?? 0}</h3>
          <div className="hint" style={{ marginTop: 6 }}>검토 대기 중인 콘텐츠 신고</div>
        </div>
      </div>

      <div className="box" style={{ marginBottom: 14 }}>
        <h3>🚩 신고 검토 큐</h3>
        {reports.error && <div className="banner err">{reports.error}</div>}
        {!reports.loading && (reports.data?.reports.length ?? 0) === 0 && (
          <div className="hint" style={{ marginTop: 8 }}>대기 중인 신고가 없습니다. 👍</div>
        )}
        {(reports.data?.reports ?? []).map((r) => (
          <ReportRow key={r.report_id} r={r} onResolve={resolve} />
        ))}
      </div>

      <div className="box" style={{ marginBottom: 14 }}>
        <h3>🎟️ 프로모션 쿠폰</h3>
        <div className="coupon-form">
          <input
            value={cCode}
            onChange={(e) => setCCode(e.target.value.toUpperCase())}
            placeholder="코드 (예: SPRING20)"
          />
          <select value={cKind} onChange={(e) => setCKind(e.target.value as "percent" | "fixed")}>
            <option value="percent">% 할인</option>
            <option value="fixed">₩ 정액</option>
          </select>
          <input
            type="number"
            value={cValue}
            onChange={(e) => setCValue(e.target.value)}
            placeholder={cKind === "percent" ? "20 (=20%)" : "5000 (원)"}
          />
          <button className="btn pri" onClick={createCoupon}>
            발급
          </button>
        </div>
        {(coupons.data?.coupons.length ?? 0) === 0 ? (
          <div className="hint" style={{ marginTop: 8 }}>발급된 쿠폰이 없습니다.</div>
        ) : (
          <table style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <th>코드</th>
                <th>할인</th>
                <th>사용</th>
                <th>상태</th>
              </tr>
              {coupons.data!.coupons.map((c) => (
                <tr key={c.code}>
                  <td style={{ fontFamily: "monospace" }}>{c.code}</td>
                  <td>{c.kind === "percent" ? `${Math.round(c.value * 100)}%` : krw(c.value)}</td>
                  <td>
                    {c.redemptions}
                    {c.max_redemptions ? ` / ${c.max_redemptions}` : ""}
                  </td>
                  <td>
                    <span className={`pill ${c.active ? "g" : "d"}`}>{c.active ? "활성" : "비활성"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="box">
        <h3 style={{ marginBottom: 8 }}>📒 이벤트 이력</h3>
        <div className="plugbar" style={{ marginBottom: 10 }}>
          {EVENT_TABS.map((t) => (
            <div key={t.id} className={`plug ${filter === t.id ? "on" : ""}`} onClick={() => setFilter(t.id)}>
              {t.label}
              {t.id !== "all" && counts[t.id] ? ` (${counts[t.id]})` : ""}
            </div>
          ))}
        </div>
        <table>
          <tbody>
            <tr>
              <th>#</th>
              <th>이벤트</th>
              <th>액터</th>
              <th>요약</th>
              <th>시각</th>
              <th>해시</th>
            </tr>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6}>해당 이벤트가 없습니다.</td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr key={e.entry_id}>
                <td>{e.index}</td>
                <td>
                  <span className={`pill ${eventPill(e.event_type)}`}>{e.event_type}</span>
                </td>
                <td>{e.actor}</td>
                <td>{summarize(e)}</td>
                <td style={{ fontSize: 11, color: "var(--mut)" }}>{new Date(e.timestamp).toLocaleString("ko-KR")}</td>
                <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{e.payload_hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportRow({ r, onResolve }: { r: Report; onResolve: (id: string, s: "actioned" | "dismissed") => void }) {
  return (
    <div className="audit-report">
      <div className="ar-info">
        <div className="ar-title">
          <span className="pill w">{r.target_type}</span> {r.target_id.slice(0, 18)}…
        </div>
        <div className="hint" style={{ marginTop: 3 }}>
          사유: {r.reason} · 신고자 {r.reporter_id} · {new Date(r.created_at).toLocaleString("ko-KR")}
        </div>
      </div>
      <div className="ar-act">
        <button className="btn pri" onClick={() => onResolve(r.report_id, "actioned")}>
          조치
        </button>
        <button className="btn gho" onClick={() => onResolve(r.report_id, "dismissed")}>
          기각
        </button>
      </div>
    </div>
  );
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function eventPill(t: string): string {
  return t === "settle" ? "g" : t === "export" ? "b" : t === "adjust" ? "w" : "p";
}
function summarize(e: LedgerEntry): string {
  const p = e.payload;
  if (e.event_type === "create") return `${p.result ?? ""} · ${p.action ?? ""}`.trim();
  if (e.event_type === "export")
    return `${p.use_type ?? p.decision ?? ""} ${p.fee_amount ? krw(num(p.fee_amount)) : ""}`.trim();
  if (e.event_type === "settle") return `${krw(num(p.fee_amount ?? p.amount))} → ${p.license_doc ?? ""}`;
  return JSON.stringify(p).slice(0, 40);
}
