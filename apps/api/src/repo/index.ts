import { MemoryRepo } from "./memory.js";
import { DrizzleRepo, migrate, type DrizzleDB } from "./drizzle/repo.js";
import { schema } from "./drizzle/schema.js";
import type { Repo } from "./types.js";

export type { Repo } from "./types.js";
export { MemoryRepo } from "./memory.js";
export { DrizzleRepo } from "./drizzle/repo.js";

/**
 * Build the repository for the current environment:
 *   DATABASE_URL set   → Postgres via node-postgres (production)
 *   USE_PGLITE=1       → embedded Postgres (PGlite) — real SQL, no server
 *   otherwise          → in-memory (default for dev/test)
 */
export async function createRepo(env: NodeJS.ProcessEnv = process.env): Promise<Repo> {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const db = drizzle(pool, { schema });
    return bootstrapDrizzle(db);
  }

  if (env.USE_PGLITE === "1") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite(env.PGLITE_DIR); // undefined → in-memory
    const db = drizzle(client, { schema }) as unknown as DrizzleDB;
    return bootstrapDrizzle(db);
  }

  return new MemoryRepo();
}

async function bootstrapDrizzle(db: DrizzleDB): Promise<Repo> {
  await migrate(db);
  const repo = new DrizzleRepo(db);
  await repo.seedIfEmpty();
  return repo;
}
