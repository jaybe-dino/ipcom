import type { LedgerEntry } from "@remix-hub/core";
import { api } from "../api.js";
import { krw, useAsync } from "../useAsync.js";

export function SettleScreen() {
  const { data, loading, error } = useAsync(() => api.getLedger(), []);
  const entries = data?.entries ?? [];

  const exportEntries = entries.filter((e) => e.event_type === "export");
  const settleEntries = entries.filter((e) => e.event_type === "settle");
  const totalSettled = settleEntries.reduce((sum, e) => sum + num(e.payload.fee_amount), 0);
  const creatorRevenue = settleEntries.reduce((sum, e) => sum + dist(e).creator, 0);

  return (
    <section>
      <div className="scr-head">
        <h2>정산 대시보드</h2>
        <p>외부 반출·판매에서 발생한 수익과 분배 내역. 모든 건은 라이선스 원장에 기록됩니다.</p>
      </div>

      {loading && <div className="box">불러오는 중…</div>}
      {error && <div className="banner err">API 연결 실패: {error}</div>}

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="box">
          <p>외부 반출 요청</p>
          <h3 style={{ fontSize: 22, marginTop: 4 }}>{exportEntries.length} 건</h3>
        </div>
        <div className="box">
          <p>총 정산액</p>
          <h3 style={{ fontSize: 22, marginTop: 4 }}>{krw(totalSettled)}</h3>
        </div>
        <div className="box">
          <p>창작자 수익</p>
          <h3 style={{ fontSize: 22, marginTop: 4 }}>{krw(creatorRevenue)}</h3>
        </div>
      </div>

      <div className="box">
        <h3>
          📒 라이선스 원장 — 전체 이벤트{" "}
          <span className={`pill ${data?.integrity_ok ? "g" : "d"}`}>
            {data?.integrity_ok ? "무결성 OK" : "무결성 손상"}
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
                <td colSpan={5}>아직 원장 기록이 없습니다. ②~③ 화면에서 생성·반출을 수행하세요.</td>
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

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function dist(e: LedgerEntry): { owner: number; creator: number; platform: number } {
  const d = e.payload.distribution as { owner?: number; creator?: number; platform?: number } | undefined;
  return { owner: d?.owner ?? 0, creator: d?.creator ?? 0, platform: d?.platform ?? 0 };
}
function eventPill(t: string): string {
  return t === "settle" ? "g" : t === "export" ? "b" : t === "adjust" ? "w" : "p";
}
function summarize(e: LedgerEntry): string {
  const p = e.payload;
  if (e.event_type === "create") return `${p.result} · ${p.action ?? ""}`;
  if (e.event_type === "export") return `${p.use_type ?? p.decision ?? ""} ${p.fee_amount ? krw(num(p.fee_amount)) : ""}`.trim();
  if (e.event_type === "settle") return `${krw(num(p.fee_amount))} → ${p.license_doc}`;
  return JSON.stringify(p).slice(0, 40);
}
