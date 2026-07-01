import { useState } from "react";
import { ApiError, api } from "../api.js";
import { useAsync } from "../useAsync.js";
import { useSession } from "../useSession.js";

const COVERS = [
  "linear-gradient(135deg,#3a2b6e,#7c5cff)",
  "linear-gradient(135deg,#1c3a44,#23d6a0)",
  "linear-gradient(135deg,#5a2a4d,#ffb020)",
  "linear-gradient(135deg,#23305a,#3aa0ff)",
];

export function HomeScreen({ onEnter }: { onEnter: (spaceId: string) => void }) {
  const user = useSession();
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useAsync(() => api.listSpaces(), [version]);
  const mine = useAsync(() => (user ? api.mySpaces() : Promise.resolve({ spaces: [] })), [version, user]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const myIds = new Set((mine.data?.spaces ?? []).map((s) => s.space_id));

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { space } = await api.createSpace(name.trim());
      setName("");
      setCreating(false);
      onEnter(space.space_id);
    } catch (e) {
      setMsg(`생성 실패: ${e instanceof ApiError ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function join(spaceId: string) {
    setBusy(true);
    try {
      await api.joinSpace(spaceId);
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="scr-head">
        <h2>스페이스 탐색</h2>
        <p>관심 있는 커뮤니티에 참여하거나, 직접 스페이스를 만들어 팬·크리에이터를 모으세요.</p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {creating ? (
          <div className="chatinput" style={{ maxWidth: 420 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="스페이스 이름 (예: 인디 음악 팬클럽)"
            />
            <button className="gen" onClick={create} disabled={busy}>
              만들기
            </button>
          </div>
        ) : (
          <button className="btn pri" onClick={() => setCreating(true)}>
            ＋ 스페이스 만들기
          </button>
        )}
      </div>

      {msg && <div className="banner err">{msg}</div>}
      {loading && <div className="box">불러오는 중…</div>}
      {error && <div className="banner err">API 연결 실패: {error}</div>}

      <div className="spaces">
        {(data?.spaces ?? []).map((sp, i) => {
          const joined = myIds.has(sp.space_id);
          return (
            <div className="sp-card" key={sp.space_id}>
              <div className="cover" style={{ background: COVERS[i % COVERS.length] }} onClick={() => onEnter(sp.space_id)}>
                <span className="badge pill g">{joined ? "참여 중" : "커뮤니티"}</span>
              </div>
              <div className="info">
                <h4>{sp.name}</h4>
                <div className="stats">
                  <span>👤 {sp.member_count.toLocaleString()}</span>
                  <span>🟢 {sp.online_count.toLocaleString()} 온라인</span>
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
                  <button className="btn gho" style={{ flex: 1 }} onClick={() => onEnter(sp.space_id)}>
                    입장
                  </button>
                  {!joined && (
                    <button className="btn pri" style={{ flex: 1 }} onClick={() => join(sp.space_id)} disabled={busy}>
                      가입
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="box">
          <h3>🔓 안에서는 마음껏</h3>
          <p>스페이스 내부에서는 허용 범위 안에서 무제한·무수수료로 대화하고 창작합니다.</p>
        </div>
        <div className="box">
          <h3>🚪 밖으로는 허락받고</h3>
          <p>결과물을 외부로 내보낼 때(공유·활용·판매)만 조건부 승인과 정산이 작동합니다.</p>
        </div>
        <div className="box">
          <h3>🛡️ 처벌 걱정 없이</h3>
          <p>딥페이크·초상권 금지선을 시스템이 차단하고, 모든 생성물에 AI 표시가 부착됩니다.</p>
        </div>
      </div>
    </section>
  );
}
