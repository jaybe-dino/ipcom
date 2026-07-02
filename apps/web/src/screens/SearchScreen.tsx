import type { Listing, Space } from "@remix-hub/client-core";
import { useState } from "react";
import { api } from "../api.js";
import { krw } from "../useAsync.js";

interface Results {
  spaces: Space[];
  users: { user_id: string; display_name?: string; role: string }[];
  listings: Listing[];
}

export function SearchScreen({ onEnter }: { onEnter: (spaceId: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.search(q.trim());
      setRes({ spaces: r.spaces, users: r.users, listings: r.listings });
    } finally {
      setBusy(false);
    }
  }

  const empty = res && res.spaces.length === 0 && res.users.length === 0 && res.listings.length === 0;

  return (
    <section>
      <div className="scr-head">
        <h2>검색 🔎</h2>
        <p>스페이스·유저·마켓 작품을 한 번에 찾습니다.</p>
      </div>

      <div className="chatinput" style={{ maxWidth: 560, marginBottom: 18 }}>
        <span>🔎</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="검색어 입력 (예: 아티스트, 네온, 민지)"
        />
        <button className="gen" onClick={run} disabled={busy}>
          검색
        </button>
      </div>

      {empty && <div className="box">"{q}"에 대한 결과가 없습니다.</div>}

      {res && res.spaces.length > 0 && (
        <>
          <div className="ch-grp" style={{ margin: "0 0 8px" }}>스페이스</div>
          <div className="spaces" style={{ marginBottom: 18 }}>
            {res.spaces.map((s) => (
              <div className="sp-card" key={s.space_id}>
                <div className="cover" style={{ background: "var(--grad)" }} onClick={() => onEnter(s.space_id)} />
                <div className="info">
                  <h4>{s.name}</h4>
                  <div className="stats"><span>👤 {s.member_count.toLocaleString()}</span></div>
                  <button className="btn gho" style={{ width: "100%", marginTop: 10 }} onClick={() => onEnter(s.space_id)}>
                    입장
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {res && res.users.length > 0 && (
        <div className="box" style={{ marginBottom: 18 }}>
          <div className="ch-grp" style={{ margin: "0 0 10px" }}>유저</div>
          {res.users.map((u) => (
            <div key={u.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
              <div className="sb-av">{(u.display_name?.[0] ?? "?").toUpperCase()}</div>
              <div>
                <b>{u.display_name ?? u.user_id}</b>
                <span className="pill p" style={{ marginLeft: 8 }}>{u.role}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {res && res.listings.length > 0 && (
        <div className="grid g3">
          {res.listings.map((l) => (
            <div className="box" key={l.listing_id}>
              <h3>{l.kind === "template" ? "⚡" : "🖼️"} {l.title}</h3>
              <p>{l.kind === "template" ? "프롬프트 템플릿" : "작품 라이선스"}</p>
              <b style={{ color: "var(--acc2)" }}>{krw(l.price)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
