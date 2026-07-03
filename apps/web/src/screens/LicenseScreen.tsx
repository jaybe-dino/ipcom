import type { BrandLicenseItem } from "@remix-hub/client-core";
import { useState } from "react";
import { ApiError, api } from "../api.js";
import { krw, useAsync } from "../useAsync.js";
import { useSession } from "../useSession.js";

const ICON: Record<string, string> = {
  image: "🖼️",
  video_recast: "🎬",
  music: "🎵",
  voice: "🎙️",
  characterize: "🧊",
};

/**
 * Brand Licensing — the marketplace's third side. A brand browses fan/AI-made
 * creations open for commercial use and requests a license, which routes into
 * the IP owner's approval queue and settles through the Rights Engine. This is
 * what a fan storefront (bStage-style) structurally cannot offer.
 */
export function LicenseScreen() {
  const user = useSession();
  const [version, setVersion] = useState(0);
  const catalog = useAsync(() => api.licenseCatalog(), [version]);
  const [active, setActive] = useState<BrandLicenseItem | null>(null);
  const [brand, setBrand] = useState("");
  const [useCase, setUseCase] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const items = (catalog.data?.catalog ?? []).filter((c) => c.commercial_allowed);

  async function submit() {
    if (!active || !brand.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.requestBrandLicense(active.creation_id, { brand: brand.trim(), use_case: useCase.trim() || undefined });
      setMsg({ kind: "ok", text: `${brand.trim()}의 라이선스 요청이 IP 소유자 승인 대기열로 전달되었습니다.` });
      setActive(null);
      setBrand("");
      setUseCase("");
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "요청에 실패했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="scr-head">
        <h2>
          브랜드 라이선싱 <span className="pill p">3rd side</span>
        </h2>
        <p>팬·AI가 만든 승인 콘텐츠를 브랜드가 상업적으로 라이선스합니다. 요청은 IP 소유자 승인을 거쳐 권리 엔진으로 정산됩니다.</p>
      </div>

      {catalog.error && <div className="banner err">API 연결 실패: {catalog.error}</div>}
      {!user && <div className="banner err">라이선스를 요청하려면 상단에서 로그인하세요.</div>}
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
      {!catalog.loading && items.length === 0 && (
        <div className="box">현재 상업 라이선스가 가능한 공유 창작물이 없습니다.</div>
      )}

      <div className="grid g3">
        {items.map((c) => (
          <div className="box lic-card" key={c.creation_id}>
            <div className="lic-thumb">{ICON[c.action] ?? "🎨"}</div>
            <div className="lic-body">
              <div className="lic-ip">🎫 {c.ip_name}</div>
              <div className="lic-id">
                [{c.action}] {c.creation_id.slice(0, 14)}…
              </div>
              <div className="lic-meta">
                <span className="pill g">상업 이용 가능</span>
                {c.indicative_fee != null && <span className="lic-fee">지시가 {krw(c.indicative_fee)}</span>}
              </div>
            </div>
            <button className="btn pri" disabled={!user} onClick={() => setActive(c)}>
              라이선스 요청
            </button>
          </div>
        ))}
      </div>

      {active && (
        <div className="lic-overlay" onClick={() => setActive(null)}>
          <div className="lic-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lic-modal-head">
              <b>브랜드 라이선스 요청</b>
              <button className="btn gho" onClick={() => setActive(null)}>
                ✕
              </button>
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              {active.ip_name} · [{active.action}] {active.creation_id.slice(0, 14)}…
              {active.indicative_fee != null && <> · 지시가 {krw(active.indicative_fee)}</>}
            </p>
            <label className="lic-field">
              <span>브랜드명 *</span>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="예: NOVA Cosmetics" />
            </label>
            <label className="lic-field">
              <span>사용 목적</span>
              <input value={useCase} onChange={(e) => setUseCase(e.target.value)} placeholder="예: 봄 캠페인 키비주얼" />
            </label>
            <button className="btn pri" style={{ width: "100%", marginTop: 6 }} disabled={busy || !brand.trim()} onClick={submit}>
              {busy ? "요청 중…" : "승인 요청 보내기"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
