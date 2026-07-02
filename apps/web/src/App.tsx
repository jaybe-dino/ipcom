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
import { SearchScreen } from "./screens/SearchScreen.js";
import { SettleScreen } from "./screens/SettleScreen.js";
import { SpaceScreen } from "./screens/SpaceScreen.js";

export type ScreenId = "home" | "space" | "dm" | "search" | "gate" | "consent" | "settle" | "market";

// Single top-level nav. Divider (after 마켓) visually separates community from
// the creator-studio tools without becoming a second sidebar.
const NAV: ({ id: ScreenId; label: string; icon: string } | { divider: true })[] = [
  { id: "home", label: "홈", icon: "🏠" },
  { id: "space", label: "커뮤니티", icon: "💬" },
  { id: "dm", label: "DM", icon: "✉️" },
  { id: "search", label: "검색", icon: "🔎" },
  { id: "market", label: "마켓", icon: "🛍️" },
  { divider: true },
  { id: "gate", label: "반출", icon: "🚪" },
  { id: "consent", label: "동의", icon: "🎛️" },
  { id: "settle", label: "정산", icon: "📊" },
];

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

  const go = (id: ScreenId) => {
    setScreen(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!user) return <AuthScreen />;

  const initial = (user.display_name?.[0] ?? "?").toUpperCase();

  return (
    <div className="shell">
      {/* Single top-level navigation bar */}
      <header className="topbar">
        <div className="brand">
          <div className="logo">R</div>
          <div className="brand-txt">
            <b>REMIX HUB</b>
            <span>IP × AI 커뮤니티</span>
          </div>
        </div>

        <nav className="topnav">
          {NAV.map((it, i) =>
            "divider" in it ? (
              <span className="topnav-div" key={`d${i}`} />
            ) : (
              <button
                key={it.id}
                className={`topnav-link ${screen === it.id ? "on" : ""}`}
                onClick={() => go(it.id)}
              >
                <span className="ic">{it.icon}</span>
                <span className="lbl">{it.label}</span>
              </button>
            ),
          )}
        </nav>

        <div className="top-actions">
          <NotificationBell />
          <div className="top-user" title={ROLE_LABEL[user.role] ?? user.role}>
            <div className="sb-av">{initial}</div>
            <span className="top-user-name">{user.display_name ?? user.user_id}</span>
          </div>
          <button className="btn gho" onClick={() => session.clear()}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="app-main">
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
          {screen === "search" && (
            <SearchScreen
              onEnter={(id) => {
                setSpaceId(id);
                go("space");
              }}
            />
          )}
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
