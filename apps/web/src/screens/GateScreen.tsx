import { distribute, exportDecision, type IP, type UseType } from "@remix-hub/core";
import { useState } from "react";
import { ApiError, api } from "../api.js";
import { krw, useAsync } from "../useAsync.js";

const IP_ID = "ip_artist_g";

const USE_OPTIONS: { use: UseType; title: string; desc: string; badge: string; badgeText: string; price: string }[] = [
  { use: "personal", title: "개인 공유", desc: "비상업 SNS 게시 등 · 워터마크 부착", badge: "g", badgeText: "자동 승인", price: "₩1,000" },
  { use: "commercial", title: "상업적 활용", desc: "광고·콘텐츠 소재 · 범위·기간별 라이선스", badge: "w", badgeText: "IP 검토", price: "₩500,000~" },
  { use: "sale", title: "판매", desc: "작품 자체 거래 · 판매가 기준 수익 분배", badge: "w", badgeText: "IP 검토", price: "판매가의 %" },
];

export function GateScreen({
  creationId,
  onCancel,
  onDone,
}: {
  creationId: string | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const consent = useAsync(() => api.getConsent(IP_ID), []);
  const [use, setUse] = useState<UseType>("commercial");
  const [salePrice, setSalePrice] = useState(100_000);
  const [step, setStep] = useState(1);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Client-side preview using the shared core engine (same logic the server runs).
  const ip: IP | null = consent.data ? ({ ip_id: IP_ID, owner_id: "user_owner_g", name: "아티스트 G", verification: "official", policy: consent.data.policy }) : null;
  let preview: { fee: number; dist: { owner: number; creator: number; platform: number } } | null = null;
  if (ip) {
    try {
      const v = exportDecision(ip, use, { sale_price: salePrice });
      preview = v.split ? { fee: v.fee, dist: distribute(v.fee, v.split) } : { fee: 0, dist: { owner: 0, creator: 0, platform: 0 } };
    } catch {
      preview = null;
    }
  }

  async function submit() {
    if (!creationId) {
      setMsg({ kind: "err", text: "반출할 생성물이 선택되지 않았습니다. ② 화면에서 '외부 반출'을 눌러주세요." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { export: exp } = await api.requestExport(creationId, {
        use_type: use,
        sale_price: use === "sale" ? salePrice : undefined,
      });
      setStep(3);
      // personal → auto; commercial/sale → owner approves (demo acts as owner).
      if (exp.approval === "pending") {
        await api.approveExport(exp.export_id, true);
      }
      const { distribution } = await api.payExport(exp.export_id);
      setMsg({
        kind: "ok",
        text: `라이선스 발급 완료 · 분배 ${krw(distribution.owner)} / ${krw(distribution.creator)} / ${krw(distribution.platform)}`,
      });
      setTimeout(onDone, 1200);
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "unknown";
      setMsg({ kind: "err", text: reason === "export_denied_by_policy" ? "이 용도는 IP 정책상 반출이 금지되어 있습니다." : `반출 실패: ${reason}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="scr-head">
        <h2>외부 반출 게이트 (G3)</h2>
        <p>결과물을 커뮤니티 밖으로 내보내는 유일한 통로. 용도를 선택하면 조건부 승인과 정산이 작동합니다.</p>
      </div>

      <div className="gate">
        <div className="gh">
          <div className="ic">🚪</div>
          <div>
            <b>외부 반출 신청</b>
            <div style={{ fontSize: 11.5, color: "var(--mut)" }}>
              {creationId ?? "(생성물 미선택)"} · 출처 IP: 아티스트 G
            </div>
          </div>
        </div>
        <div className="gb">
          <div className="steps">
            <div className={`st ${step >= 1 ? "on" : ""}`}>1. 용도 선택</div>
            <div className={`st ${step >= 2 ? "on" : ""}`}>2. 조건·정산</div>
            <div className={`st ${step >= 3 ? "on" : ""}`}>3. 승인·발급</div>
          </div>

          <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 9 }}>반출 용도를 선택하세요</div>
          {USE_OPTIONS.map((o) => (
            <div
              key={o.use}
              className={`opt ${use === o.use ? "sel" : ""}`}
              onClick={() => {
                setUse(o.use);
                setStep(2);
              }}
            >
              <div className="l">
                <b>
                  {o.title} <span className={`pill ${o.badge}`}>{o.badgeText}</span>
                </b>
                <p>{o.desc}</p>
              </div>
              <div className="r">{o.price}</div>
            </div>
          ))}

          {use === "sale" && (
            <div className="inputrow" style={{ marginBottom: 10 }}>
              <span>₩</span>
              <input
                type="number"
                value={salePrice}
                onChange={(e) => setSalePrice(Number(e.target.value))}
                placeholder="판매가"
              />
            </div>
          )}

          <div className="ledger">
            <div>
              <span>선택 용도</span>
              <b>{USE_OPTIONS.find((o) => o.use === use)?.title}</b>
            </div>
            <div>
              <span>예상 금액</span>
              <b>{preview ? krw(preview.fee) : "—"}</b>
            </div>
            <div>
              <span>↳ IP 소유자</span>
              <b>{preview ? krw(preview.dist.owner) : "—"}</b>
            </div>
            <div>
              <span>↳ 창작자</span>
              <b>{preview ? krw(preview.dist.creator) : "—"}</b>
            </div>
            <div>
              <span>↳ 플랫폼</span>
              <b>{preview ? krw(preview.dist.platform) : "—"}</b>
            </div>
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 5, paddingTop: 7 }}>
              <span>발급물</span>
              <b>라이선스 증명서 + AI 가시 표시</b>
            </div>
          </div>

          {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn gho" style={{ flex: 1 }} onClick={onCancel}>
              취소
            </button>
            <button className="btn pri" style={{ flex: 2 }} onClick={submit} disabled={busy}>
              {busy ? "처리 중…" : "승인 요청 + 정산 →"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
