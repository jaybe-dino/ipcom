import type { Listing } from "@remix-hub/core";
import { useState } from "react";
import { ApiError, api } from "../api.js";
import { krw, useAsync } from "../useAsync.js";
import { useSession } from "../useSession.js";

export function MarketScreen() {
  const user = useSession();
  const [version, setVersion] = useState(0);
  const catalog = useAsync(() => api.marketCatalog(), [version]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(listing: Listing) {
    setBusy(listing.listing_id);
    setMsg(null);
    try {
      const { order } = await api.buyListing(listing.listing_id);
      setMsg({
        kind: "ok",
        text: `구매 완료 · 라이선스 발급 · 분배 ${krw(order.distribution.owner)} / ${krw(order.distribution.creator)} / ${krw(order.distribution.platform)}`,
      });
      setVersion((v) => v + 1);
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "unknown";
      setMsg({
        kind: "err",
        text:
          reason === "cannot_buy_own_listing"
            ? "자신의 리스팅은 구매할 수 없습니다."
            : `구매 실패: ${reason}`,
      });
    } finally {
      setBusy(null);
    }
  }

  const listings = catalog.data?.listings ?? [];

  return (
    <section>
      <div className="scr-head">
        <h2>
          마켓플레이스 <span className="pill p">P2</span>
        </h2>
        <p>반출 가능한 작품·프롬프트 템플릿을 거래합니다. 구매 시 라이선스가 자동 발급되고 take rate가 적용됩니다.</p>
      </div>

      {catalog.error && <div className="banner err">API 연결 실패: {catalog.error}</div>}
      {!user && <div className="banner err">구매하려면 상단에서 데모 로그인하세요.</div>}
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      {listings.length === 0 && !catalog.loading && (
        <div className="box">아직 리스팅이 없습니다. ② 화면에서 생성 후 판매 등록할 수 있습니다.</div>
      )}

      <div className="grid g3">
        {listings.map((l) => (
          <div className="box" key={l.listing_id}>
            <h3>
              {l.kind === "template" ? "⚡" : "🖼️"} {l.title}
            </h3>
            <p>
              {l.kind === "template" ? "프롬프트 템플릿" : "작품 라이선스"} · 판매자 {l.seller_id}
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <b style={{ color: "var(--acc2)", fontSize: 15 }}>{krw(l.price)}</b>
              <button className="btn pri" disabled={!user || busy === l.listing_id} onClick={() => buy(l)}>
                {busy === l.listing_id ? "처리 중…" : "구매"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
