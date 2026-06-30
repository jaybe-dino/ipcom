import { randomUUID } from "node:crypto";

/** Centralized id + clock helpers so handlers stay deterministic-friendly. */
export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const now = (): string => new Date().toISOString();
