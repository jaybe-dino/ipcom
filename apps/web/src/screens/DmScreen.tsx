import type { Post, User } from "@remix-hub/client-core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { subscribeChannel } from "../realtime.js";
import { useSession } from "../useSession.js";

type Dm = { channel_id: string; peer: User };

const colorFor = (id: string) =>
  ["#7c5cff", "#23d6a0", "#3aa0ff", "#ffb020", "#ff5d6c"][
    [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5
  ];

export function DmScreen({ initialChannel }: { initialChannel?: string | null }) {
  const user = useSession();
  const [dms, setDms] = useState<Dm[]>([]);
  const [active, setActive] = useState<string | null>(initialChannel ?? null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const loadDms = () => api.myDms().then((r) => setDms(r.dms)).catch(() => setDms([]));
  useEffect(() => {
    void loadDms();
  }, []);
  useEffect(() => {
    if (initialChannel) setActive(initialChannel);
  }, [initialChannel]);

  useEffect(() => {
    if (!active) return;
    void api.getChannelPosts(active).then((r) => setPosts(r.posts)).catch(() => setPosts([]));
    if (!user) return;
    return subscribeChannel(active, (e) => {
      if (e.type === "post.created") {
        const p = e.post as Post;
        setPosts((prev) => (prev.some((x) => x.post_id === p.post_id) ? prev : [...prev, p]));
      }
    });
  }, [active, user]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [posts]);

  const peerName = (chId: string) => dms.find((d) => d.channel_id === chId)?.peer.display_name ?? "상대";

  async function send() {
    const t = text.trim();
    if (!t || !active) return;
    setText("");
    try {
      await api.sendMessage(active, t);
    } catch {
      setText(t);
    }
  }

  return (
    <section>
      <div className="scr-head">
        <h2>다이렉트 메시지</h2>
        <p>멤버와 1:1로 대화하세요. 참여자 외에는 볼 수 없는 비공개 대화입니다.</p>
      </div>

      <div className="layout" style={{ gridTemplateColumns: "240px 1fr" }}>
        <div className="channels">
          <div className="ch-grp">대화 목록</div>
          {dms.length === 0 && <div className="hint" style={{ padding: 8 }}>아직 DM이 없습니다. 커뮤니티 멤버 패널에서 "DM"을 눌러 시작하세요.</div>}
          {dms.map((d) => (
            <div
              key={d.channel_id}
              className={`ch ${d.channel_id === active ? "on" : ""}`}
              onClick={() => setActive(d.channel_id)}
            >
              <span className="av" style={{ width: 24, height: 24, fontSize: 11, background: colorFor(d.peer.user_id) }}>
                {(d.peer.display_name?.[0] ?? "?").toUpperCase()}
              </span>{" "}
              {d.peer.display_name ?? d.peer.user_id}
            </div>
          ))}
        </div>

        <div className="main">
          {active ? (
            <>
              <div className="main-head">
                <div className="t"># {peerName(active)} <span>· 비공개 DM</span></div>
                <span className="pill g">실시간</span>
              </div>
              <div className="feed" ref={feedRef}>
                {posts.length === 0 && <div className="hint">첫 메시지를 보내보세요 👋</div>}
                {posts.map((p) => {
                  const mine = p.author_id === user?.user_id;
                  return (
                    <div className="post" key={p.post_id} style={{ flexDirection: mine ? "row-reverse" : "row" }}>
                      <div className="av" style={{ background: colorFor(p.author_id) }}>
                        {mine ? "나" : (peerName(active)[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="body" style={{ textAlign: mine ? "right" : "left" }}>
                        <div className="txt">{p.text}</div>
                        <span className="time">{new Date(p.created_at).toLocaleTimeString("ko-KR")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="composer">
                <div className="chatinput">
                  <span>💬</span>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder={`${peerName(active)}에게 메시지`}
                  />
                  <button className="gen" onClick={send}>
                    보내기
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="feed">
              <div className="hint">왼쪽에서 대화를 선택하세요.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
