/** Minimal, dependency-free CSV serialization (RFC 4180 quoting). */

/** Quote a single field: wrap in quotes and double embedded quotes when needed. */
function cell(value: unknown): string {
  const s =
    value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize rows to CSV given ordered columns. Each column maps a header label
 * to an accessor. A UTF-8 BOM is prefixed so Excel renders Korean correctly.
 */
export function toCsv<T>(rows: T[], columns: { header: string; get: (row: T) => unknown }[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.get(r))).join(",")).join("\r\n");
  return `﻿${head}\r\n${body}`;
}
