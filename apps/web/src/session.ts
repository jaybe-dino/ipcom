import type { User } from "@remix-hub/core";

/**
 * Client-side auth session. Holds the JWT + current user, persisted to
 * localStorage, with a tiny subscribe API so React components re-render on
 * login/logout.
 */
const TOKEN_KEY = "remixhub.token";
const USER_KEY = "remixhub.user";

let token: string | null = localStorage.getItem(TOKEN_KEY);
let user: User | null = safeParse(localStorage.getItem(USER_KEY));
const listeners = new Set<() => void>();

function safeParse(raw: string | null): User | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function emit() {
  for (const l of listeners) l();
}

export const session = {
  get token() {
    return token;
  },
  get user() {
    return user;
  },
  set(next: { token: string; user: User }) {
    token = next.token;
    user = next.user;
    localStorage.setItem(TOKEN_KEY, next.token);
    localStorage.setItem(USER_KEY, JSON.stringify(next.user));
    emit();
  },
  clear() {
    token = null;
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
