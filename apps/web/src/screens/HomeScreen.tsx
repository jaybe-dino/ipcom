import { api } from "../api.js";
import { useAsync } from "../useAsync.js";

const COVERS = [
  "linear-gradient(135deg,#3a2b6e,#7c5cff)",
  "linear-gradient(135deg,#1c3a44,#23d6a0)",
  "linear-gradient(135deg,#5a2a4d,#ffb020)",
];

export function HomeScreen({ onEnter }: { onEnter: (spaceId: string) => void }) {
  const { data, loading, error } = useAsync(() => api.listSpaces(), []);

  return (
    <section>
      <div className="scr-head">
        <h2>스페이스 탐색</h2>
        <p>
          IP·주제 단위 커뮤니티("스페이스")를 둘러보고 참여합니다. 입장 시 해당 IP의 허용 범위
          약관에 동의합니다.
        </p>
      </div>

      {loading && <div className="box">불러오는 중…</div>}
      {error && <div className="banner err">API 연결 실패: {error} — 서버(apps/api)를 먼저 실행하세요.</div>}

      <div className="spaces">
        {(data?.spaces ?? []).map((sp, i) => (
          <div className="sp-card" key={sp.space_id} onClick={() => onEnter(sp.space_id)}>
            <div className="cover" style={{ background: COVERS[i % COVERS.length] }}>
              <span className="badge pill g">공식 인증 IP</span>
            </div>
            <div className="info">
              <h4>{sp.name}</h4>
              <div className="m">이미지·음악·영상 2차창작 허용</div>
              <div className="stats">
                <span>👤 {sp.member_count.toLocaleString()}</span>
                <span>🟢 {sp.online_count.toLocaleString()} 온라인</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="box">
          <h3>🔓 안에서는 마음껏</h3>
          <p>스페이스 내부에서는 IP 소유자가 허용한 범위 안에서 무제한·무수수료로 생성하고 공유합니다.</p>
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
