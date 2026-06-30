import type { User } from "@remix-hub/core";

/**
 * Pluggable persistence so the same Session works across platforms:
 * web → localStorage, mobile → AsyncStorage, tests → memory. Methods may be
 * sync or async; the Session awaits them.
 */
export interface SessionStorage {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export class MemoryStorage implements SessionStorage {
  private map = new Map<string, string>();
  get(key: string) {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  remove(key: string) {
    this.map.delete(key);
  }
}

const TOKEN_KEY = "remixhub.token";
const USER_KEY = "remixhub.user";

/**
 * Auth session: holds the JWT + current user in memory, persists via the
 * injected storage, and notifies subscribers on change. Platform UIs bind to
 * `subscribe` (e.g. React's useSyncExternalStore).
 */
export class Session {
  private _token: string | null = null;
  private _user: User | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly storage: SessionStorage = new MemoryStorage()) {}

  /** Load any persisted session. Call once at startup. */
  async init(): Promise<void> {
    this._token = (await this.storage.get(TOKEN_KEY)) ?? null;
    const rawUser = await this.storage.get(USER_KEY);
    this._user = rawUser ? safeParse(rawUser) : null;
    this.emit();
  }

  get token(): string | null {
    return this._token;
  }
  get user(): User | null {
    return this._user;
  }

  set(next: { token: string; user: User }): void {
    this._token = next.token;
    this._user = next.user;
    void this.storage.set(TOKEN_KEY, next.token);
    void this.storage.set(USER_KEY, JSON.stringify(next.user));
    this.emit();
  }

  clear(): void {
    this._token = null;
    this._user = null;
    void this.storage.remove(TOKEN_KEY);
    void this.storage.remove(USER_KEY);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function safeParse(raw: string): User | null {
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}
