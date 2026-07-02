import type { Listing } from "@remix-hub/core";
import { useState } from "react";
import { ApiError, api } from "../api.js";
import { krw, useAsync } from "../useAsync.js";
import { useSession } from "../useSession.js";

export function MarketScreen() {
  const user = useSession();
  const [version, setVersion] = useState(0);
  const catalog = useAsync(() => api.marketCatalog(), [version]);
  const orders = useAsync(() => (user ? api.myOrders() : Promise.resolve({ orders: [] })), [version, !!user]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Fetch a purchased order's license manifest and download it as JSON. */
  async function downloadLicense(orderId: string) {
    try {
      const { license } = await api.orderLicense(orderId);
      const blob = new Blob([JSON.stringify(license, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `license-${orderId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "라이선스를 불러오지 못했습니다." });
    }
  }

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

      {user && (orders.data?.orders.length ?? 0) > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="scr-head">
            <h3>🧾 내 구매 · 라이선스</h3>
            <p>구매한 작품·템플릿과 자동 발급된 라이선스 문서입니다.</p>
          </div>
          <table>
            <tbody>
              <tr>
                <th>항목</th>
                <th>금액</th>
                <th>상태</th>
                <th>구매일</th>
                <th>라이선스</th>
              </tr>
              {orders.data!.orders.map((o) => (
                <tr key={o.order_id}>
                  <td>{o.listing_title}</td>
                  <td>{krw(o.amount)}</td>
                  <td>
                    <span className={`pill ${o.status === "paid" ? "g" : "w"}`}>{o.status}</span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--mut)" }}>
                    {new Date(o.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td>
                    {o.license_doc ? (
                      <button className="btn gho" onClick={() => downloadLicense(o.order_id)}>
                        ⬇ 다운로드
                      </button>
                    ) : (
                      <span className="hint">미발급</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
