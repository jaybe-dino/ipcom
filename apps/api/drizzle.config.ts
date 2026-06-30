import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config for generating/applying SQL migrations against a real
 * Postgres (set DATABASE_URL). The runtime also has a built-in `migrate()` that
 * creates tables idempotently, so this is optional for local/dev.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/repo/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/remixhub",
  },
});
