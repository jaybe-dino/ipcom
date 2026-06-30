import { Session, type SessionStorage } from "@remix-hub/client-core";

/** Web persistence adapter backed by localStorage (synchronous). */
const localStorageAdapter: SessionStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
};

/** Shared session instance for the web app. */
export const session = new Session(localStorageAdapter);
