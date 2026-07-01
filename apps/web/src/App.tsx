import { useState } from "react";
import { NotificationBell } from "./components/NotificationBell.js";
import { session } from "./session.js";
import { useSession } from "./useSession.js";
import { AuthScreen } from "./screens/AuthScreen.js";
import { ConsentScreen } from "./screens/ConsentScreen.js";
import { DmScreen } from "./screens/DmScreen.js";
import { GateScreen } from "./screens/GateScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { MarketScreen } from "./screens/MarketScreen.js";
import { SettleScreen } from "./screens/SettleScreen.js";
import { SpaceScreen } from "./screens/SpaceScreen.js";

export type ScreenId = "home" | "space" | "dm" | "gate" | "consent" | "settle" | "market";

const NAV_GROUPS: { title: string; items: { id: ScreenId; label: string; icon: string }[] }[] = [
  {
    title: "커뮤니티",
    items: [
      { id: "home", label: "홈 · 스페이스 탐색", icon: "🏠" },
      { id: "space", label: "커뮤니티 채팅", icon: "💬" },
      { id: "dm", label: "다이렉트 메시지", icon: "✉️" },
      { id: "market", label: "마켓플레이스", icon: "🛍️" },
    ],
  },
  {
    title: "크리에이터 스튜디오",
    items: [
      { id: "gate", label: "외부 반출 게이트", icon: "🚪" },
      { id: "consent", label: "IP 동의 매트릭스", icon: "🎛️" },
      { id: "settle", label: "정산 대시보드", icon: "📊" },
    ],
  },
];

const TITLES: Record<ScreenId, string> = {
  home: "홈",
  space: "커뮤니티 채팅",
  dm: "다이렉트 메시지",
  market: "마켓플레이스",
  gate: "외부 반출 게이트",
  consent: "IP 동의 매트릭스",
  settle: "정산 대시보드",
};

const SEED_SPACE = "space_artist_g";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "IP 소유자",
  CREATOR: "크리에이터",
  BUYER: "바이어",
  ADMIN: "관리자",
};

export function App() {
  const user = useSession();
  const [screen, setScreen] = useState<ScreenId>("home");
  const [exportCreationId, setExportCreationId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string>(SEED_SPACE);
  const [dmChannel, setDmChannel] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const go = (id: ScreenId) => {
    setScreen(id);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!user) return <AuthScreen />;

  const initial = (user.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className={`shell ${mobileNav ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="logo">R</div>
          <div className="sb-brand-txt">
            <b>REMIX HUB</b>
            <span>IP × AI 커뮤니티</span>
          </div>
        </div>

        <nav className="sb-nav">
          {NAV_GROUPS.map((g) => (
            <div className="sb-group" key={g.title}>
              <div className="sb-title">{g.title}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  className={`sb-link ${screen === it.id ? "on" : ""}`}
                  onClick={() => go(it.id)}
                >
                  <span className="sb-ic">{it.icon}</span>
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <div className="sb-user">
            <div className="sb-av">{initial}</div>
            <div className="sb-user-txt">
              <b>{user.display_name ?? user.user_id}</b>
              <span>{ROLE_LABEL[user.role] ?? user.role}</span>
            </div>
          </div>
          <button className="btn gho sb-logout" onClick={() => session.clear()}>
            로그아웃
          </button>
        </div>
      </aside>

      {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}

      <main className="app-main">
        <header className="app-top">
          <button className="nav-toggle" onClick={() => setMobileNav((v) => !v)} aria-label="메뉴">
            ☰
          </button>
          <div className="app-title">{TITLES[screen]}</div>
          <div className="app-actions">
            <NotificationBell />
          </div>
        </header>

        <div className="app-content">
          {screen === "home" && (
            <HomeScreen
              onEnter={(id) => {
                setSpaceId(id);
                go("space");
              }}
            />
          )}
          {screen === "space" && (
            <SpaceScreen
              spaceId={spaceId}
              onExport={(creationId) => {
                setExportCreationId(creationId);
                go("gate");
              }}
              onOpenDm={(channelId) => {
                setDmChannel(channelId);
                go("dm");
              }}
            />
          )}
          {screen === "dm" && <DmScreen initialChannel={dmChannel} />}
          {screen === "gate" && (
            <GateScreen creationId={exportCreationId} onCancel={() => go("space")} onDone={() => go("settle")} />
          )}
          {screen === "consent" && <ConsentScreen />}
          {screen === "settle" && <SettleScreen />}
          {screen === "market" && <MarketScreen />}
        </div>
      </main>
    </div>
  );
}
