import type { Notification } from "@remix-hub/client-core";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useSession } from "../useSession.js";

const LABEL: Record<Notification["type"], string> = {
  mention: "언급",
  reply: "답글",
  dm: "DM",
};

/** Bell with unread badge; polls the count and shows a dropdown on click. */
export function NotificationBell() {
  const user = useSession();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = () => api.unreadCount().then((r) => alive && setCount(r.count)).catch(() => {});
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const { notifications } = await api.notifications();
      setItems(notifications);
      await api.markNotificationsRead();
      setCount(0);
    }
  }

  if (!user) return null;

  return (
    <div className="bell-wrap">
      <button className="bell" onClick={toggle} title="알림">
        🔔
        {count > 0 && <span className="bell-badge">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <div className="bell-menu">
          <div className="bell-head">알림</div>
          {items.length === 0 && <div className="bell-empty">새 알림이 없습니다.</div>}
          {items.map((n) => (
            <div key={n.notification_id} className={`bell-item ${n.read ? "" : "unread"}`}>
              <span className={`pill ${n.type === "dm" ? "b" : n.type === "mention" ? "p" : "g"}`}>
                {LABEL[n.type]}
              </span>
              <span className="bell-text">{n.text || "(내용 없음)"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
