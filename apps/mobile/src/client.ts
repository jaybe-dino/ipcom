import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session, createApi, type SessionStorage } from "@remix-hub/client-core";

/**
 * API base URL. Mobile can't use a relative "/api" proxy, so point at the
 * machine running the API:
 *   - Android emulator: http://10.0.2.2:4000
 *   - iOS simulator:    http://localhost:4000
 *   - Physical device:  http://<your-LAN-ip>:4000
 * Override with the EXPO_PUBLIC_API_BASE env var.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://10.0.2.2:4000";

/** AsyncStorage-backed session persistence (async). */
const storage: SessionStorage = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};

export const session = new Session(storage);
export const api = createApi({ baseUrl: API_BASE, session });
