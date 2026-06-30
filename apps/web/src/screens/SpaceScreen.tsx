import type { Channel, Creation, CreativeAction, Post } from "@remix-hub/core";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api.js";
import { useAsync } from "../useAsync.js";

const SPACE_ID = "space_artist_g";

const PLUGINS: { action: CreativeAction; label: string }[] = [
  { action: "image", label: "🖼️ 이미지" },
  { action: "video_recast", label: "🎬 영상·리캐스트" },
  { action: "music", label: "🎵 음악" },
  { action: "voice", label: "🎙️ 보이스" },
  { action: "characterize", label: "🧊 캐릭터화" },
];

export function SpaceScreen({ onExport }: { onExport: (creationId: string) => void }) {
  const space = useAsync(() => api.getSpace(SPACE_ID), []);
  const [activeChannel, setActiveChannel] = useState<string>("ch_image_remix");
  const [action, setAction] = useState<CreativeAction>("image");
  const [prompt, setPrompt] = useState("아티스트 G 컨셉, 비 내리는 네온 거리, 시네마틱 라이팅...");
  const [posts, setPosts] = useState<Post[]>([]);
  const [creations, setCreations] = useState<Record<string, Creation>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  async function loadFeed(channelId: string) {
    try {
      const { posts, creations } = await api.getChannelPosts(channelId);
      setPosts(posts);
      setCreations(Object.fromEntries(creations.map((c) => [c.creation_id, c])));
    } catch {
      setPosts([]);
      setCreations({});
    }
  }

  useEffect(() => {
    void loadFeed(activeChannel);
  }, [activeChannel]);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const { creation } = await api.generate(SPACE_ID, { action, prompt });
      setCreations((c) => ({ ...c, [creation.creation_id]: creation }));
      setPosts((p) => [
        ...p,
        {
          post_id: `local_${creation.creation_id}`,
          channel_id: activeChannel,
          author_id: creation.creator_id,
          text: prompt,
          creation_id: creation.creation_id,
          created_at: creation.created_at,
        },
      ]);
      setMsg({ kind: "ok", text: "생성 완료 — 출처 IP·라이선스·AI 표시 메타데이터가 부착되었습니다." });
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "unknown";
      setMsg({
        kind: "err",
        text:
          reason === "hard_limit"
            ? "🚫 금지선(Hard Limit)에 의해 생성이 차단되었습니다."
            : reason === "not_allowed"
              ? "이 IP는 해당 행위를 허용하지 않습니다 (Consent Matrix)."
              : `생성 실패: ${reason}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const channels = space.data?.channels ?? [];
  const grouped = groupChannels(channels);

  return (
    <section>
      <div className="scr-head">
        <h2>채널 + AI 창작 캔버스</h2>
        <p>Discord형 채널 안에서 바로 AI 플러그인을 호출해 창작합니다. 내부 공유는 무제한·무수수료(G1·G2).</p>
      </div>

      {space.error && <div className="banner err">API 연결 실패: {space.error}</div>}

      <div className="layout">
        <div className="rail">
          <div className="s on">G</div>
          <div className="div" />
          <div className="s">+</div>
        </div>

        <div className="channels">
          <div className="sp-name">
            {space.data?.space.name ?? "스페이스"} <span className="pill g">인증</span>
          </div>
          {grouped.map((grp) => (
            <div key={grp.title}>
              <div className="ch-grp">{grp.title}</div>
              {grp.items.map((c) => (
                <div
                  key={c.channel_id}
                  className={`ch ${c.channel_id === activeChannel ? "on" : ""}`}
                  onClick={() => setActiveChannel(c.channel_id)}
                >
                  <span className="h">#</span> {c.name}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="main">
          <div className="main-head">
            <div className="t">
              # {channels.find((c) => c.channel_id === activeChannel)?.name ?? "채널"}{" "}
              <span>· IP 소유자가 허용한 행위만 생성 가능</span>
            </div>
            <span className="pill g">G1·G2 무료 구간</span>
          </div>

          <div className="feed">
            {posts.length === 0 && <div className="hint">아직 게시물이 없습니다. 아래에서 생성해보세요.</div>}
            {posts.map((p) => {
              const cr = p.creation_id ? creations[p.creation_id] : undefined;
              return (
                <div className="post" key={p.post_id}>
                  <div className="av">민</div>
                  <div className="body">
                    <div className="meta">
                      <b>민지</b>
                      <span className="pill p">크리에이터</span>
                      <span className="time">{new Date(p.created_at).toLocaleTimeString("ko-KR")}</span>
                    </div>
                    {p.text && <div className="txt">{p.text}</div>}
                    {cr && (
                      <div className="card">
                        <div className="thumb">
                          [{cr.action} 생성 미리보기]
                          <span className="wm">🤖 AI 생성 · REMIX HUB</span>
                        </div>
                        <div className="cbody">
                          <div className="ct">{cr.creation_id}</div>
                          <div className="cmeta">
                            <span>🧩 {cr.plugin_id}</span>
                            <span>출처 IP: 아티스트 G</span>
                            <span className="pill g">{cr.status}</span>
                          </div>
                        </div>
                        <div className="cact">
                          <button className="btn gho">리믹스</button>
                          <button className="btn pri" onClick={() => onExport(cr.creation_id)}>
                            외부 반출 →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="composer">
            <div className="plugbar">
              {PLUGINS.map((pl) => (
                <div
                  key={pl.action}
                  className={`plug ${pl.action === action ? "on" : ""}`}
                  onClick={() => setAction(pl.action)}
                >
                  {pl.label}
                </div>
              ))}
            </div>
            <div className="inputrow">
              <span>✏️</span>
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <button className="gen" onClick={generate} disabled={busy}>
                {busy ? "생성 중…" : "생성 ✨"}
              </button>
            </div>
            {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
            <div className="hint">
              🔒 생성물은 자동으로 출처 IP·라이선스·AI 표시 메타데이터가 부착됩니다. 금지 맥락(성적·허위·협박)은
              생성 단계에서 차단됩니다.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function groupChannels(channels: Channel[]) {
  const titles: Record<Channel["type"], string> = {
    creation: "창작 채널",
    community: "커뮤니티",
    market: "마켓",
  };
  const order: Channel["type"][] = ["creation", "community", "market"];
  return order
    .map((type) => ({ title: titles[type], items: channels.filter((c) => c.type === type) }))
    .filter((g) => g.items.length > 0);
}
