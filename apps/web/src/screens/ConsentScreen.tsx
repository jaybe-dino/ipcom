import { CREATIVE_ACTIONS, HARD_LIMIT_CATEGORIES, USE_TYPES, type CreativeAction } from "@remix-hub/core";
import { api } from "../api.js";
import { useAsync } from "../useAsync.js";

const IP_ID = "ip_artist_g";

const ACTION_LABELS: Record<CreativeAction, string> = {
  image: "이미지 생성",
  video_recast: "영상 출연자 교체",
  voice: "음성 합성",
  music: "음악·음원 생성",
  characterize: "2차 캐릭터화",
};

const HARD_LABELS: Record<string, string> = {
  sexual: "성적 맥락",
  defamation: "허위사실·명예훼손",
  harassment: "협박·괴롭힘",
  political_abuse: "정치적 악용",
};

const POLICY_PILL: Record<string, { cls: string; text: string }> = {
  auto: { cls: "g", text: "자동 승인" },
  review: { cls: "w", text: "검토 후 승인" },
  deny: { cls: "d", text: "금지" },
};

const USE_LABELS: Record<string, string> = { personal: "개인 공유", commercial: "상업적 활용", sale: "판매" };

export function ConsentScreen() {
  const { data, loading, error } = useAsync(() => api.getConsent(IP_ID), []);
  const policy = data?.policy;

  return (
    <section>
      <div className="scr-head">
        <h2>
          IP 동의 매트릭스 <span className="pill b">IP 소유자 화면</span>
        </h2>
        <p>IP 소유자가 허용 행위·금지선·외부 반출 정책·수익 분배율을 직접 설정합니다.</p>
      </div>

      {loading && <div className="box">불러오는 중…</div>}
      {error && <div className="banner err">API 연결 실패: {error}</div>}

      {policy && (
        <div className="grid g2">
          <div className="box">
            <h3>🎛️ 허용 행위</h3>
            <div className="matrix">
              {CREATIVE_ACTIONS.map((a) => (
                <div className="row" key={a}>
                  <span>{ACTION_LABELS[a]}</span>
                  <div className={`tog ${policy.allowed_actions[a] ? "on" : ""}`}>
                    <i />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="box">
            <h3>🚫 절대 금지선 (Hard Limit)</h3>
            <p style={{ marginBottom: 8 }}>플랫폼이 IP 동의와 무관하게 강제 차단 — 해제 불가</p>
            <div className="matrix">
              {HARD_LIMIT_CATEGORIES.map((c) => (
                <div className="row" key={c}>
                  <span>{HARD_LABELS[c]}</span>
                  <div className="tog lock">
                    <i />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="box">
            <h3>🚪 외부 반출 정책</h3>
            <table style={{ marginTop: 4 }}>
              <tbody>
                <tr>
                  <th>용도</th>
                  <th>승인 방식</th>
                </tr>
                {USE_TYPES.map((u) => {
                  const pill = POLICY_PILL[policy.export_policy[u]]!;
                  return (
                    <tr key={u}>
                      <td>{USE_LABELS[u]}</td>
                      <td>
                        <span className={`pill ${pill.cls}`}>{pill.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="box">
            <h3>💰 수익 분배율 (판매)</h3>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {(["owner", "creator", "platform"] as const).map((k, i) => {
                const pct = Math.round(policy.revenue_split.sale[k] * 100);
                const color = ["var(--acc)", "var(--acc2)", "var(--blue)"][i];
                const label = ["IP 소유자", "창작자", "플랫폼"][i];
                return (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0 4px" }}>
                      <span>{label}</span>
                      <b>{pct}%</b>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
