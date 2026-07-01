import { useState } from "react";
import { AuthBar } from "./components/AuthBar.js";
import { NotificationBell } from "./components/NotificationBell.js";
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

const NAV: { id: ScreenId; label: string }[] = [
  { id: "home", label: "① 스페이스 탐색" },
  { id: "space", label: "② 커뮤니티 · 채팅" },
  { id: "dm", label: "③ DM" },
  { id: "gate", label: "④ 외부 반출 게이트" },
  { id: "consent", label: "⑤ IP 동의 매트릭스" },
  { id: "settle", label: "⑥ 정산 대시보드" },
  { id: "market", label: "⑦ 마켓플레이스" },
];

const SEED_SPACE = "space_artist_g";

export function App() {
  const user = useSession();
  const [screen, setScreen] = useState<ScreenId>("space");
  // The creation currently selected for export (drives the Gate screen).
  const [exportCreationId, setExportCreationId] = useState<string | null>(null);
  // Which community space the chat screen is showing.
  const [spaceId, setSpaceId] = useState<string>(SEED_SPACE);
  // Active DM channel (set when opening a DM from the member panel).
  const [dmChannel, setDmChannel] = useState<string | null>(null);

  const go = (id: ScreenId) => {
    setScreen(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Community is gated: sign in (or sign up) to enter.
  if (!user) return <AuthScreen />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">R</div>
          <div>
            <h1>
              REMIX HUB <span className="pill p">v0.1</span>
            </h1>
            <div className="tag">IP × AI 2차창작 커뮤니티</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NotificationBell />
          <AuthBar />
        </div>
      </div>

      <div className="nav">
        {NAV.map((n) => (
          <button key={n.id} className={screen === n.id ? "on" : ""} onClick={() => go(n.id)}>
            {n.label}
          </button>
        ))}
      </div>

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

      <div className="foot">
        REMIX HUB · 서비스 v0.1 (MVP 스캐폴드) · 안에서는 마음껏, 밖으로는 허락받고
      </div>
    </div>
  );
}
