import { useSyncExternalStore } from "react";
import { session } from "./session.js";

/** React binding for the auth session; re-renders on login/logout. */
export function useSession() {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.user,
    () => session.user,
  );
}
