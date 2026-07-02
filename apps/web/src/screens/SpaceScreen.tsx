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

// Mirrors the server's ACTION_CAPABILITY so we can filter models per action.
const ACTION_CAP: Record<CreativeAction, string> = {
  image: "image",
  video_recast: "video",
  music: "music",
  voice: "voice",
  characterize: "image",
};

const COLORS = ["#7c5cff", "#23d6a0", "#3aa0ff", "#ffb020", "#ff5d6c"];
const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

const PALETTE = ["🔥", "❤️", "😂", "👍", "🎉", "👏"];

export function SpaceScreen({
  spaceId,
  onExport,
  onOpenDm,
}: {
  spaceId: string;
  onExport: (creationId: string) => void;
  onOpenDm: (channelId: string) => void;
}) {
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const skipScroll = useRef(false);
  const [typing, setTyping] = useState<Record<string, string>>({}); // user_id → display_name
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const lastTypingSent = useRef(0);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [mode, setMode] = useState<"chat" | "ai">("chat");
  const [text, setText] = useState("");
  const [action, setAction] = useState<CreativeAction>("image");
  const [prompt, setPrompt] = useState("아티스트 G 컨셉, 비 내리는 네온 거리...");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [remixParent, setRemixParent] = useState<Creation | null>(null);
  const [pluginId, setPluginId] = useState<string>(""); // "" = auto (Rights Engine picks)
  const [lineage, setLineage] = useState<
    { creation: Creation; ancestors: Creation[]; children: Creation[]; depth: number } | null
  >(null);
  const [lineageBusy, setLineageBusy] = useState(false);
  const inventory = useAsync(() => api.plugins(), []);
  const feedRef = useRef<HTMLDivElement>(null);

  function upsert(post: Post, author?: AuthorRef | null, creation?: Creation | null) {
    if (author) setAuthors((a) => ({ ...a, [author.user_id]: author }));
    if (creation) setCreations((c) => mergeCreation(c, creation));
    setPosts((p) => {
      if (p.some((x) => x.post_id === post.post_id)) return p;
      if (post.creation_id && p.some((x) => x.creation_id === post.creation_id)) return p;
      return [...p, post];
    });
  }

  async function loadFeed(channelId: string) {
    try {
      const { posts, creations, authors, reactions, hasMore } = await api.getChannelPosts(channelId, {
        limit: 50,
      });
      setPosts(posts);
      setCreations(Object.fromEntries(creations.map((c) => [c.creation_id, c])));
      setAuthors(authors);
      setReactions(reactions);
      setHasMore(hasMore);
    } catch {
      setPosts([]);
      setCreations({});
      setReactions({});
      setHasMore(false);
    }
  }

  async function loadOlder() {
    const oldest = posts[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.getChannelPosts(activeChannel, { limit: 50, before: oldest.created_at });
      skipScroll.current = true; // prepending — keep viewport
      setCreations((c) => ({ ...c, ...Object.fromEntries(res.creations.map((x) => [x.creation_id, x])) }));
      setAuthors((a) => ({ ...a, ...res.authors }));
      setReactions((r) => ({ ...r, ...res.reactions }));
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.post_id));
        return [...res.posts.filter((p) => !seen.has(p.post_id)), ...prev];
      });
      setHasMore(res.hasMore);
    } finally {
      setLoadingOlder(false);
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

  function onType(v: string) {
    setText(v);
    const t = Date.now();
    if (activeChannel && t - lastTypingSent.current > 2500) {
      lastTypingSent.current = t;
      void api.typing(activeChannel);
    }
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
      } else if (e.type === "creation.updated") {
        const cr = e.creation as Creation;
        setCreations((c) => mergeCreation(c, cr));
      } else if (e.type === "reaction.updated") {
        applyReaction(e.post_id as string, e.emoji as string, e.added as boolean, e.user_id as string);
      } else if (e.type === "post.updated") {
        setPosts((prev) =>
          prev.map((p) =>
            p.post_id === e.post_id ? { ...p, text: e.text as string, edited_at: e.edited_at as string } : p,
          ),
        );
      } else if (e.type === "post.deleted") {
        setPosts((prev) => prev.filter((p) => p.post_id !== e.post_id));
      } else if (e.type === "presence.updated") {
        loadMembers();
      } else if (e.type === "typing.updated") {
        const uid2 = e.user_id as string;
        if (uid2 === user?.user_id) return;
        setTyping((t) => ({ ...t, [uid2]: e.display_name as string }));
        clearTimeout(typingTimers.current[uid2]);
        typingTimers.current[uid2] = setTimeout(() => {
          setTyping((t) => {
            const { [uid2]: _drop, ...rest } = t;
            return rest;
          });
        }, 4000);
      }
    });
  }, [activeChannel, user]);

  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [posts]);

  async function sendChat() {
    const t = text.trim();
    if (!t && !pendingImage) return;
    setText("");
    const reply = replyTo?.post_id ?? null;
    setReplyTo(null);
    const img = pendingImage;
    setPendingImage(null);
    try {
      await api.sendMessage(activeChannel, t, { replyTo: reply, imageUrl: img }); // WS echo renders it
    } catch (e) {
      setMsg({ kind: "err", text: `전송 실패: ${(e as Error).message}` });
      setText(t);
      setPendingImage(img);
    }
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const { creation } = await api.generate(spaceId, {
        action,
        prompt,
        channel_id: activeChannel,
        parent_creation_id: remixParent?.creation_id,
        plugin_id: pluginId || undefined,
      });
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
      setMsg({
        kind: "ok",
        text: remixParent
          ? "리믹스 완료 — 원본과의 계보가 기록되었습니다 (출처·AI 표시 부착)."
          : "생성 완료 — 채널에 공유되었습니다 (출처·AI 표시 부착).",
      });
      setRemixParent(null);
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

  /** Begin a remix: set the parent and switch the composer to AI mode. */
  function startRemix(parent: Creation) {
    setRemixParent(parent);
    setMode("ai");
    setAction(parent.action);
    setMsg({ kind: "ok", text: "리믹스 원본을 선택했습니다. 프롬프트를 다듬고 생성하세요." });
  }

  /** Open the lineage (버전/계보) tree for a creation. */
  async function openLineage(creationId: string) {
    setLineageBusy(true);
    try {
      setLineage(await api.lineage(creationId));
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiError ? e.message : "계보를 불러오지 못했습니다." });
    } finally {
      setLineageBusy(false);
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
            {hasMore && (
              <button className="load-older" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? "불러오는 중…" : "↑ 이전 메시지 더보기"}
              </button>
            )}
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
                      {p.author_id === user?.user_id && p.text && (
                        <>
                          <button
                            className="reply-btn"
                            onClick={async () => {
                              const next = window.prompt("메시지 수정", p.text ?? "");
                              if (next && next.trim() && next !== p.text) await api.editMessage(p.post_id, next.trim());
                            }}
                          >
                            수정
                          </button>
                          <button
                            className="reply-btn"
                            onClick={async () => {
                              if (window.confirm("이 메시지를 삭제할까요?")) await api.deleteMessage(p.post_id);
                            }}
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                    {p.reply_to && postsById[p.reply_to] && (
                      <div className="quote">
                        ↩ {nameOf(postsById[p.reply_to]!.author_id)}: {postsById[p.reply_to]!.text?.slice(0, 60)}
                      </div>
                    )}
                    {p.text && (
                      <div className="txt">
                        {p.text}
                        {p.edited_at && <span className="edited"> (수정됨)</span>}
                      </div>
                    )}
                    {p.image_url && (
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer">
                        <img className="msg-img" src={p.image_url} alt="첨부 이미지" loading="lazy" />
                      </a>
                    )}
                    {cr && (
                      <div className="card">
                        <div className={`thumb ${cr.status === "generating" ? "generating" : ""}`}>
                          {cr.status === "generating" ? (
                            <span className="gen-spin">✨ 생성 중…</span>
                          ) : cr.status === "failed" ? (
                            <span>⚠️ 생성 실패</span>
                          ) : (
                            <>[{cr.action} 생성]<span className="wm">🤖 AI 생성 · REMIX HUB</span></>
                          )}
                        </div>
                        <div className="cbody">
                          <div className="cmeta">
                            <span>🧩 {cr.plugin_id}</span>
                            {cr.parent_creation_id && <span className="pill p">↳ 리믹스</span>}
                            <span className={`pill ${cr.status === "generating" ? "w" : cr.status === "failed" ? "d" : "g"}`}>
                              {cr.status}
                            </span>
                          </div>
                        </div>
                        <div className="cact">
                          <button
                            className="btn pri"
                            disabled={cr.status === "generating" || cr.status === "failed"}
                            onClick={() => onExport(cr.creation_id)}
                          >
                            외부 반출 →
                          </button>
                          <button
                            className="btn gho"
                            disabled={cr.status !== "generated" && cr.status !== "shared" && cr.status !== "exported"}
                            onClick={() => startRemix(cr)}
                          >
                            🔗 리믹스
                          </button>
                          <button className="btn gho" disabled={lineageBusy} onClick={() => openLineage(cr.creation_id)}>
                            🌿 계보
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
            {Object.keys(typing).length > 0 && (
              <div className="typing">✍️ {Object.values(typing).join(", ")} 님이 입력 중…</div>
            )}
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
                {pendingImage && (
                  <div className="reply-chip">
                    🖼️ 이미지 첨부됨
                    <button onClick={() => setPendingImage(null)}>✕</button>
                  </div>
                )}
                <div className="chatinput">
                  <button
                    className="img-btn"
                    title="이미지 URL 첨부"
                    onClick={() => {
                      const url = window.prompt("이미지 URL을 붙여넣으세요 (https://…)");
                      if (url && /^https?:\/\//i.test(url)) setPendingImage(url.trim());
                    }}
                  >
                    🖼️
                  </button>
                  <input
                    value={text}
                    onChange={(e) => onType(e.target.value)}
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
                {remixParent && (
                  <div className="reply-chip">
                    🔗 리믹스 원본: [{remixParent.action}] {remixParent.creation_id.slice(0, 12)}…
                    <button onClick={() => setRemixParent(null)}>✕</button>
                  </div>
                )}
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
                <div className="modelrow">
                  <span className="hint">🧠 모델</span>
                  <select value={pluginId} onChange={(e) => setPluginId(e.target.value)}>
                    <option value="">자동 (권한 엔진이 선택)</option>
                    {(inventory.data?.plugins ?? [])
                      .filter((p) => p.capabilities.includes(ACTION_CAP[action]))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {pluginLabel(p.id)}
                        </option>
                      ))}
                  </select>
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
                {m.user_id !== user?.user_id && (
                  <button
                    className="dm-btn"
                    title="DM 보내기"
                    onClick={async () => {
                      const { channel_id } = await api.openDm(m.user_id);
                      onOpenDm(channel_id);
                    }}
                  >
                    ✉
                  </button>
                )}
              </div>
            ))}
        </div>
      </div>

      {lineage && (
        <div className="lin-overlay" onClick={() => setLineage(null)}>
          <div className="lin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lin-head">
              <b>🌿 버전 계보</b>
              <span className="mut">
                루트로부터 {lineage.depth}단계 · 파생 {lineage.children.length}개
              </span>
              <button className="btn gho" onClick={() => setLineage(null)}>
                ✕
              </button>
            </div>
            <div className="lin-body">
              <div className="lin-chain">
                {[...lineage.ancestors].reverse().map((a) => (
                  <LineageNode key={a.creation_id} c={a} nameOf={nameOf} onOpen={openLineage} />
                ))}
                <LineageNode c={lineage.creation} nameOf={nameOf} current />
              </div>
              {lineage.children.length > 0 && (
                <>
                  <div className="lin-grp">↳ 파생(리믹스) {lineage.children.length}</div>
                  <div className="lin-children">
                    {lineage.children.map((ch) => (
                      <LineageNode key={ch.creation_id} c={ch} nameOf={nameOf} onOpen={openLineage} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** A single node in the lineage tree. */
function LineageNode({
  c,
  nameOf,
  current,
  onOpen,
}: {
  c: Creation;
  nameOf: (uid: string) => string;
  current?: boolean;
  onOpen?: (id: string) => void;
}) {
  return (
    <div className={`lin-node ${current ? "cur" : ""}`}>
      <span className="lin-ico">{current ? "⭐" : c.parent_creation_id ? "↳" : "◉"}</span>
      <div className="lin-info">
        <div className="lin-title">
          [{c.action}] {c.creation_id.slice(0, 14)}…
          {current && <span className="pill p">현재</span>}
        </div>
        <div className="lin-sub">
          {nameOf(c.creator_id)} · 🧩 {c.plugin_id} · {c.status}
        </div>
      </div>
      {!current && onOpen && (
        <button className="btn gho" onClick={() => onOpen(c.creation_id)}>
          보기
        </button>
      )}
    </div>
  );
}

// Merge a creation into the map without letting a stale "generating" clobber a
// newer terminal state. The optimistic write in generate(), the WS post.created
// echo, and the WS creation.updated can arrive in any order; ranking keeps the
// most-progressed status so a resolved card never reverts to the spinner.
const CREATION_RANK: Record<string, number> = { generating: 0, failed: 1, generated: 1 };
function mergeCreation(
  map: Record<string, Creation>,
  incoming: Creation,
): Record<string, Creation> {
  const prev = map[incoming.creation_id];
  if (prev && (CREATION_RANK[incoming.status] ?? 0) < (CREATION_RANK[prev.status] ?? 0)) return map;
  return { ...map, [incoming.creation_id]: incoming };
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

/** Friendly names for known adapter ids; unknown ids show verbatim. */
function pluginLabel(id: string): string {
  const known: Record<string, string> = {
    "stub.local": "기본 (로컬 스텁)",
    "nvidia.nim": "NVIDIA NIM",
    "higgsfield": "Higgsfield",
  };
  return known[id] ?? id;
}

function roleLabel(role: AuthorRef["role"]): string {
  return role === "OWNER" ? "IP 소유자" : role === "CREATOR" ? "크리에이터" : role === "BUYER" ? "바이어" : "관리자";
}
