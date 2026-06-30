import type { Role } from "@remix-hub/core";
import { useState } from "react";
import { ApiError, api } from "../api.js";

/** Real signup/login gate. Shown when no session exists. */
export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("CREATOR");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "login") {
        await api.login(email.trim(), password);
      } else {
        await api.register({ email: email.trim(), password, display_name: displayName.trim() || undefined, role });
      }
      // Session set → App re-renders into the community.
    } catch (e2) {
      const reason = e2 instanceof ApiError ? e2.message : "unknown";
      setErr(translate(reason));
    } finally {
      setBusy(false);
    }
  }

  async function demo(email: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.login(email, "password");
    } catch {
      setErr("데모 로그인 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="logo">R</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800 }}>REMIX HUB</h1>
            <div className="tag">IP × AI 2차창작 커뮤니티 · 함께 대화하고 창작하세요</div>
          </div>
        </div>

        <div className="authtabs">
          <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            로그인
          </button>
          <button className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>
            회원가입
          </button>
        </div>

        <form onSubmit={submit} className="authform">
          <label>
            이메일
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            비밀번호
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          {mode === "signup" && (
            <>
              <label>
                표시 이름
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="닉네임" />
              </label>
              <label>
                역할
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="CREATOR">크리에이터 / 팬</option>
                  <option value="OWNER">IP 소유자</option>
                  <option value="BUYER">바이어</option>
                </select>
              </label>
            </>
          )}
          {err && <div className="banner err">{err}</div>}
          <button className="btn pri" type="submit" disabled={busy} style={{ width: "100%", padding: "11px" }}>
            {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>

        <div className="authdemo">
          <span>둘러보기(데모):</span>
          <button onClick={() => demo("minji@remixhub.dev")} disabled={busy}>민지</button>
          <button onClick={() => demo("owner@remixhub.dev")} disabled={busy}>오너</button>
        </div>
      </div>
    </div>
  );
}

function translate(reason: string): string {
  switch (reason) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "email_taken":
      return "이미 가입된 이메일입니다.";
    case "email_and_password_required":
      return "이메일과 비밀번호를 입력하세요.";
    default:
      return `오류: ${reason}`;
  }
}
