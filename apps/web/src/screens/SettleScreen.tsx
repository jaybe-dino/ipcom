import type { DailyPoint, LedgerEntry, SettlementSummary } from "@remix-hub/core";
import { api, apiUrl } from "../api.js";
import { krw, useAsync } from "../useAsync.js";

export function SettleScreen() {
  const ledger = useAsync(() => api.getLedger(), []);
  const summary = useAsync(() => api.settlementSummary(14), []);
  const entries = ledger.data?.entries ?? [];
  const s = summary.data;

  return (
    <section>
      <div className="scr-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2>정산 대시보드</h2>
          <p>외부 반출·판매에서 발생한 수익과 분배 내역. 모든 건은 라이선스 원장에 기록됩니다.</p>
        </div>
        <a className="btn gho" href={apiUrl("/settlement/summary.csv?days=14")} download>
          ⬇ 정산 CSV
        </a>
      </div>

      {(ledger.loading || summary.loading) && <div className="box">불러오는 중…</div>}
      {summary.error && <div className="banner err">API 연결 실패: {summary.error}</div>}

      {s && (
        <>
          <div className="grid g3" style={{ marginBottom: 14 }}>
            <div className="box">
              <p>총 정산액</p>
              <h3 style={{ fontSize: 24, marginTop: 4 }}>{krw(s.total_fees)}</h3>
              <div className="hint" style={{ marginTop: 4 }}>{s.settle_count}건 정산 · 반출요청 {s.export_count}건</div>
            </div>
            <div className="box">
              <p>창작자 수익</p>
              <h3 style={{ fontSize: 24, marginTop: 4 }}>{krw(s.distribution.creator)}</h3>
              <div className="hint" style={{ marginTop: 4 }}>플랫폼 {krw(s.distribution.platform)}</div>
            </div>
            <div className="box">
              <p>소스별 매출</p>
              <h3 style={{ fontSize: 16, marginTop: 6 }}>
                🚪 반출 {krw(s.by_source.export.fees)}<br />🛍️ 마켓 {krw(s.by_source.market.fees)}
              </h3>
            </div>
          </div>

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="box">
              <h3>수익 분배 비율</h3>
              <SplitBar dist={s.distribution} />
            </div>
            <div className="box">
              <h3>일별 정산 추이 (최근 14일)</h3>
              <DailyChart daily={s.daily} />
            </div>
          </div>
        </>
      )}

      <div className="box">
        <h3>
          📒 라이선스 원장 — 전체 이벤트{" "}
          <span className={`pill ${ledger.data?.integrity_ok ? "g" : "d"}`}>
            {ledger.data?.integrity_ok ? "무결성 OK" : "무결성 손상"}
          </span>
        </h3>
        <table style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <th>#</th>
              <th>이벤트</th>
              <th>액터</th>
              <th>요약</th>
              <th>해시</th>
            </tr>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5}>아직 원장 기록이 없습니다. 생성·반출·판매를 수행하세요.</td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.entry_id}>
                <td>{e.index}</td>
                <td>
                  <span className={`pill ${eventPill(e.event_type)}`}>{e.event_type}</span>
                </td>
                <td>{e.actor}</td>
                <td>{summarize(e)}</td>
                <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{e.payload_hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Horizontal 100%-stacked bar of the owner/creator/platform split. */
function SplitBar({ dist }: { dist: { owner: number; creator: number; platform: number } }) {
  const total = dist.owner + dist.creator + dist.platform;
  const parts = [
    { label: "IP 소유자", value: dist.owner, color: "#7c5cff" },
    { label: "창작자", value: dist.creator, color: "#23d6a0" },
    { label: "플랫폼", value: dist.platform, color: "#3aa0ff" },
  ];
  if (total === 0) return <div className="hint" style={{ marginTop: 10 }}>아직 정산된 수익이 없습니다.</div>;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden" }}>
        {parts.map((p) => (
          <div
            key={p.label}
            title={`${p.label} ${krw(p.value)}`}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
        {parts.map((p) => (
          <span key={p.label} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, display: "inline-block" }} />
            {p.label} · {krw(p.value)} ({total ? Math.round((p.value / total) * 100) : 0}%)
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical bar chart of daily settled fees (pure SVG). */
function DailyChart({ daily }: { daily: DailyPoint[] }) {
  const W = 460;
  const H = 150;
  const pad = 22;
  const max = Math.max(1, ...daily.map((d) => d.fees));
  const bw = (W - pad * 2) / daily.length;
  const hasData = daily.some((d) => d.fees > 0);
  return (
    <div style={{ marginTop: 10, overflowX: "auto" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="일별 정산 추이">
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" />
        {daily.map((d, i) => {
          const h = (d.fees / max) * (H - pad * 2);
          const x = pad + i * bw + 2;
          const y = H - pad - h;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={Math.max(1, bw - 4)} height={h} rx={2} fill="url(#barGrad)">
                <title>{`${d.date} · ${krw(d.fees)}`}</title>
              </rect>
              {i % 3 === 0 && (
                <text x={x + bw / 2} y={H - 6} fontSize={8} fill="var(--mut)" textAnchor="middle">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#23d6a0" />
          </linearGradient>
        </defs>
      </svg>
      {!hasData && <div className="hint">아직 정산 활동이 없습니다.</div>}
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
  if (e.event_type === "create") return `${p.result} · ${p.action ?? ""}`;
  if (e.event_type === "export") return `${p.use_type ?? p.decision ?? ""} ${p.fee_amount ? krw(num(p.fee_amount)) : ""}`.trim();
  if (e.event_type === "settle") return `${krw(num(p.fee_amount ?? p.amount))} → ${p.license_doc}`;
  return JSON.stringify(p).slice(0, 40);
}
