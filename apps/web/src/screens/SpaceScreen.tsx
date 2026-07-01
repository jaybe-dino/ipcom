import type { AuthorRef, Channel, Creation, CreativeAction, Post, ReactionSummary } from "@remix-hub/client-core";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import { subscribeChannel } from "../realtime.js";
import { useAsync } from "../useAsync.js";
import { useSession } from "../useSession.js";

const PLUGINS: { action: CreativeAction; label: string }[] = [
  { action: "image", label: "🖼️ 이미지" },
  { action: "video_recast", label: "🎬 영상" },
  { action: "music", label: "🎵 음악" },
  { action: "voice", label: "🎙️ 보이스" },
  { action: "characterize", label: "🧊 캐릭터" },
];

const COLORS = ["#7c5cff", "#23d6a0", "#3aa0ff", "#ffb020", "#ff5d6c"];
const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

const PALETTE = ["🔥", "❤️", "😂", "👍", "🎉", "👏"];

export function SpaceScreen({ spaceId, onExport }: { spaceId: string; onExport: (creationId: string) => void }) {
  const user = useSession();
  const [spaceVersion, setSpaceVersion] = useState(0);
  const space = useAsync(() => api.getSpace(spaceId), [spaceId, spaceVersion]);
  const [activeChannel, setActiveChannel] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [creations, setCreations] = useState<Record<string, Creation>>({});
  const [authors, setAuthors] = useState<Record<string, AuthorRef>>({});
  const [reactions, setReactions] = useState<Record<string, ReactionSummary[]>>({});
  const [replyTo, setReplyTo] = useState<Post | null>(null);
  const [members, setMembers] = useState<AuthorRef[]>([]);

  const [mode, setMode] = useState<"chat" | "ai">("chat");
  const [text, setText] = useState("");
  const [action, setAction] = useState<CreativeAction>("image");
  const [prompt, setPrompt] = useState("아티스트 G 컨셉, 비 내리는 네온 거리...");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  function upsert(post: Post, author?: AuthorRef | null, creation?: Creation | null) {
    if (author) setAuthors((a) => ({ ...a, [author.user_id]: author }));
    if (creation) setCreations((c) => ({ ...c, [creation.creation_id]: creation }));
    setPosts((p) => {
      if (p.some((x) => x.post_id === post.post_id)) return p;
      if (post.creation_id && p.some((x) => x.creation_id === post.creation_id)) return p;
      return [...p, post];
    });
  }

  async function loadFeed(channelId: string) {
    try {
      const { posts, creations, authors, reactions } = await api.getChannelPosts(channelId);
      setPosts(posts);
      setCreations(Object.fromEntries(creations.map((c) => [c.creation_id, c])));
      setAuthors(authors);
      setReactions(reactions);
    } catch {
      setPosts([]);
      setCreations({});
      setReactions({});
    }
  }

  /** Apply a live reaction.updated event to local state. */
  function applyReaction(postId: string, emoji: string, added: boolean, userId: string) {
    const isMe = userId === user?.user_id;
    setReactions((prev) => {
      const list = [...(prev[postId] ?? [])];
      const idx = list.findIndex((r) => r.emoji === emoji);
      if (added) {
        if (idx >= 0) list[idx] = { ...list[idx]!, count: list[idx]!.count + 1, mine: list[idx]!.mine || isMe };
        else list.push({ emoji, count: 1, mine: isMe });
      } else if (idx >= 0) {
        const count = list[idx]!.count - 1;
        if (count <= 0) list.splice(idx, 1);
        else list[idx] = { ...list[idx]!, count, mine: isMe ? false : list[idx]!.mine };
      }
      return { ...prev, [postId]: list };
    });
  }

  function toggleReaction(postId: string, emoji: string) {
    void api.react(postId, emoji); // live echo updates state via subscription
  }

  // Pick a default channel once the space's channels load (or space changes).
  const channels = space.data?.channels ?? [];
  useEffect(() => {
    if (channels.length === 0) return;
    if (!channels.some((c) => c.channel_id === activeChannel)) {
      const first = channels.find((c) => c.type === "community") ?? channels[0];
      if (first) setActiveChannel(first.channel_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.data]);

  const loadMembers = () => {
    void api.spaceMembers(spaceId).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  };
  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, spaceVersion]);

  useEffect(() => {
    if (activeChannel) void loadFeed(activeChannel);
  }, [activeChannel]);

  useEffect(() => {
    if (!user || !activeChannel) return;
    return subscribeChannel(activeChannel, (e) => {
      if (e.type === "post.created") {
        upsert(e.post as Post, e.author as AuthorRef | undefined, e.creation as Creation | undefined);
      } else if (e.type === "reaction.updated") {
        applyReaction(e.post_id as string, e.emoji as string, e.added as boolean, e.user_id as string);
      } else if (e.type === "presence.updated") {
        loadMembers();
      }
    });
  }, [activeChannel, user]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [posts]);

  async function sendChat() {
    const t = text.trim();
    if (!t) return;
    setText("");
    const reply = replyTo?.post_id ?? null;
    setReplyTo(null);
    try {
      await api.sendMessage(activeChannel, t, reply); // echoes back via WS subscription
    } catch (e) {
      setMsg({ kind: "err", text: `전송 실패: ${(e as Error).message}` });
      setText(t);
    }
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const { creation } = await api.generate(spaceId, { action, prompt, channel_id: activeChannel });
      upsert(
        {
          post_id: `local_${creation.creation_id}`,
          channel_id: activeChannel,
          author_id: creation.creator_id,
          text: prompt,
          creation_id: creation.creation_id,
          created_at: creation.created_at,
        },
        user ? { user_id: user.user_id, display_name: user.display_name, role: user.role } : null,
        creation,
      );
      setMsg({ kind: "ok", text: "생성 완료 — 채널에 공유되었습니다 (출처·AI 표시 부착)." });
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "unknown";
      setMsg({
        kind: "err",
        text:
          reason === "hard_limit"
            ? "🚫 금지선(Hard Limit)에 의해 생성이 차단되었습니다."
            : reason === "not_allowed"
              ? "이 IP는 해당 행위를 허용하지 않습니다."
              : `생성 실패: ${reason}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const grouped = groupChannels(channels);
  const activeName = channels.find((c) => c.channel_id === activeChannel)?.name ?? "채널";
  const postsById: Record<string, Post> = Object.fromEntries(posts.map((p) => [p.post_id, p]));
  const nameOf = (uid: string) => authors[uid]?.display_name ?? uid;

  async function addChannel() {
    const name = window.prompt("새 채널 이름");
    if (!name?.trim()) return;
    try {
      await api.createChannel(spaceId, { name: name.trim(), type: "community" });
      setSpaceVersion((v) => v + 1);
    } catch (e) {
      setMsg({ kind: "err", text: `채널 생성 실패: ${(e as Error).message}` });
    }
  }

  return (
    <section>
      <div className="scr-head">
        <h2>커뮤니티 · 채널</h2>
        <p>팬·크리에이터가 모여 실시간으로 대화하고, 같은 자리에서 AI로 창작합니다.</p>
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
            <span>{space.data?.space.name ?? "스페이스"}</span>
            <span className="pill g">👤 {space.data?.space.member_count ?? 0}</span>
          </div>
          {grouped.map((grp) => (
            <div key={grp.title}>
              <div className="ch-grp">
                {grp.title}
                {grp.title === "커뮤니티" && (
                  <span style={{ float: "right", cursor: "pointer", color: "var(--acc)" }} onClick={addChannel}>
                    ＋
                  </span>
                )}
              </div>
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
              # {activeName} <span>· {posts.length} 메시지</span>
            </div>
            <span className="pill g">실시간</span>
          </div>

          <div className="feed" ref={feedRef}>
            {posts.length === 0 && <div className="hint">아직 메시지가 없습니다. 첫 메시지를 남겨보세요 👋</div>}
            {posts.map((p) => {
              const cr = p.creation_id ? creations[p.creation_id] : undefined;
              const author = authors[p.author_id];
              const name = author?.display_name ?? p.author_id;
              return (
                <div className="post" key={p.post_id}>
                  <div className="av" style={{ background: colorFor(p.author_id) }}>
                    {(name?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="body">
                    <div className="meta">
                      <b>{name}</b>
                      {author?.role && <span className="pill p">{roleLabel(author.role)}</span>}
                      <span className="time">{new Date(p.created_at).toLocaleTimeString("ko-KR")}</span>
                      <button className="reply-btn" onClick={() => setReplyTo(p)}>
                        답글
                      </button>
                    </div>
                    {p.reply_to && postsById[p.reply_to] && (
                      <div className="quote">
                        ↩ {nameOf(postsById[p.reply_to]!.author_id)}: {postsById[p.reply_to]!.text?.slice(0, 60)}
                      </div>
                    )}
                    {p.text && <div className="txt">{p.text}</div>}
                    {cr && (
                      <div className="card">
                        <div className="thumb">
                          [{cr.action} 생성]
                          <span className="wm">🤖 AI 생성 · REMIX HUB</span>
                        </div>
                        <div className="cbody">
                          <div className="cmeta">
                            <span>🧩 {cr.plugin_id}</span>
                            <span className="pill g">{cr.status}</span>
                          </div>
                        </div>
                        <div className="cact">
                          <button className="btn pri" onClick={() => onExport(cr.creation_id)}>
                            외부 반출 →
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="reactions">
                      {(reactions[p.post_id] ?? []).map((r) => (
                        <button
                          key={r.emoji}
                          className={`reaction ${r.mine ? "on" : ""}`}
                          onClick={() => toggleReaction(p.post_id, r.emoji)}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                      <span className="react-add">
                        <button className="reaction add">＋</button>
                        <span className="palette">
                          {PALETTE.map((em) => (
                            <button key={em} onClick={() => toggleReaction(p.post_id, em)}>
                              {em}
                            </button>
                          ))}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="composer">
            <div className="composer-tabs">
              <button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")}>
                💬 채팅
              </button>
              <button className={mode === "ai" ? "on" : ""} onClick={() => setMode("ai")}>
                ✨ AI 생성
              </button>
            </div>

            {mode === "chat" ? (
              <>
                {replyTo && (
                  <div className="reply-chip">
                    ↩ {nameOf(replyTo.author_id)}에게 답글: {replyTo.text?.slice(0, 40)}
                    <button onClick={() => setReplyTo(null)}>✕</button>
                  </div>
                )}
                <div className="chatinput">
                  <span>💬</span>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendChat()}
                    placeholder={`#${activeName} 에 메시지 보내기`}
                  />
                  <button className="gen" onClick={sendChat}>
                    보내기
                  </button>
                </div>
              </>
            ) : (
              <>
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
                <div className="hint">
                  🔒 생성물에는 출처 IP·라이선스·AI 표시가 자동 부착됩니다. 금지 맥락은 생성 단계에서 차단됩니다.
                </div>
              </>
            )}
            {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
          </div>
        </div>

        <div className="members">
          <div className="ch-grp">멤버 — {members.length}</div>
          {[...members]
            .sort((a, b) => Number(b.online) - Number(a.online))
            .map((m) => (
              <div className={`member ${m.online ? "online" : ""}`} key={m.user_id}>
                <span className="dot" />
                <span className="mname">{m.display_name ?? m.user_id}</span>
                {m.role === "OWNER" && <span className="pill p">소유자</span>}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function groupChannels(channels: Channel[]) {
  const titles: Record<Channel["type"], string> = {
    community: "커뮤니티",
    creation: "창작 채널",
    market: "마켓",
  };
  const order: Channel["type"][] = ["community", "creation", "market"];
  return order
    .map((type) => ({ title: titles[type], items: channels.filter((c) => c.type === type) }))
    .filter((g) => g.items.length > 0);
}

function roleLabel(role: AuthorRef["role"]): string {
  return role === "OWNER" ? "IP 소유자" : role === "CREATOR" ? "크리에이터" : role === "BUYER" ? "바이어" : "관리자";
}
