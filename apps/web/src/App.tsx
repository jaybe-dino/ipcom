import { useState } from "react";
import { AuthBar } from "./components/AuthBar.js";
import { ConsentScreen } from "./screens/ConsentScreen.js";
import { GateScreen } from "./screens/GateScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SettleScreen } from "./screens/SettleScreen.js";
import { SpaceScreen } from "./screens/SpaceScreen.js";

export type ScreenId = "home" | "space" | "gate" | "consent" | "settle";

const NAV: { id: ScreenId; label: string }[] = [
  { id: "home", label: "① 스페이스 탐색" },
  { id: "space", label: "② 채널 + AI 캔버스" },
  { id: "gate", label: "③ 외부 반출 게이트" },
  { id: "consent", label: "④ IP 동의 매트릭스" },
  { id: "settle", label: "⑤ 정산 대시보드" },
];

export function App() {
  const [screen, setScreen] = useState<ScreenId>("home");
  // The creation currently selected for export (drives the Gate screen).
  const [exportCreationId, setExportCreationId] = useState<string | null>(null);

  const go = (id: ScreenId) => {
    setScreen(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
        <AuthBar />
      </div>

      <div className="nav">
        {NAV.map((n) => (
          <button key={n.id} className={screen === n.id ? "on" : ""} onClick={() => go(n.id)}>
            {n.label}
          </button>
        ))}
      </div>

      {screen === "home" && <HomeScreen onEnter={() => go("space")} />}
      {screen === "space" && (
        <SpaceScreen
          onExport={(creationId) => {
            setExportCreationId(creationId);
            go("gate");
          }}
        />
      )}
      {screen === "gate" && (
        <GateScreen creationId={exportCreationId} onCancel={() => go("space")} onDone={() => go("settle")} />
      )}
      {screen === "consent" && <ConsentScreen />}
      {screen === "settle" && <SettleScreen />}

      <div className="foot">
        REMIX HUB · 서비스 v0.1 (MVP 스캐폴드) · 안에서는 마음껏, 밖으로는 허락받고
      </div>
    </div>
  );
}
