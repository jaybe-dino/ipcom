/**
 * @remix-hub/client-core
 *
 * Headless client logic shared by every REMIX HUB front-end (web, desktop,
 * mobile): the API client, auth Session with pluggable storage, real-time
 * channel subscription, and formatters. Platform UIs add only thin bindings.
 */
export { Session, MemoryStorage, type SessionStorage } from "./session.js";
export {
  createApi,
  ApiError,
  type Api,
  type ClientConfig,
  type PluginInventory,
  type AuthorRef,
  type BrandLicenseItem,
} from "./api.js";
export {
  subscribeChannel,
  channelWsUrl,
  type ChannelEvent,
  type SubscribeConfig,
} from "./realtime.js";
export { krw } from "./format.js";

// Re-export domain types so clients can import everything from one place.
export type * from "@remix-hub/core";
