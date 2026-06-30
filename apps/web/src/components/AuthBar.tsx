import { useState } from "react";
import { ApiError, api } from "../api.js";
import { session } from "../session.js";
import { useSession } from "../useSession.js";

/** Top auth bar with quick demo logins (creator / owner) + logout. */
export function AuthBar() {
  const user = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function quickLogin(email: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.login(email, "password");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "login_failed");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="authbar">
        <span className="pill p">{user.role}</span>
        <span className="who">{user.display_name ?? user.user_id}</span>
        <button className="btn gho" onClick={() => session.clear()}>
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <div className="authbar">
      <span className="who">데모 로그인:</span>
      <button className="btn gho" disabled={busy} onClick={() => quickLogin("minji@remixhub.dev")}>
        민지 (크리에이터)
      </button>
      <button className="btn gho" disabled={busy} onClick={() => quickLogin("owner@remixhub.dev")}>
        오너 (IP 소유자)
      </button>
      {err && <span className="pill d">{err}</span>}
    </div>
  );
}
