/**
 * Shared primitive / branded types used across the REMIX HUB domain.
 */

/** ISO-8601 timestamp string (e.g. "2026-06-30T14:02:00.000Z"). */
export type ISODateTime = string;

/** Monetary amount stored as integer minor units (e.g. KRW won; JPY-style, no decimals). */
export type Money = number;

/** Default platform currency. Multi-currency settlement is a later phase (see PRD §4.6). */
export const DEFAULT_CURRENCY = "KRW" as const;
export type Currency = "KRW" | "USD" | "JPY" | "EUR";

/** A UUID string. Kept as a plain string at the type level for portability. */
export type UUID = string;
