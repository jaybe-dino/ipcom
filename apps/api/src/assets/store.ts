import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newId, now } from "../ids.js";

/**
 * Asset storage (PRD §2.1 Asset Storage/CDN). Separates internal vs export
 * access (NFR: 자산 접근권 분리). License manifests are stored as `export`-scoped
 * assets; raw generation outputs as `internal`.
 *
 * - MemoryAssetStore: default (dev/test).
 * - FsAssetStore: persistent (Railway volume / self-host) — survives restarts.
 * - An S3/GCS + CDN adapter drops in behind the same interface next.
 */
export type AssetScope = "internal" | "export";

export interface StoredAsset {
  asset_id: string;
  scope: AssetScope;
  content_type: string;
  data: unknown;
  created_at: string;
}

export interface AssetStore {
  put(input: { scope: AssetScope; content_type: string; data: unknown }): Promise<string>;
  get(id: string): Promise<StoredAsset | null>;
}

export class MemoryAssetStore implements AssetStore {
  private assets = new Map<string, StoredAsset>();

  async put(input: { scope: AssetScope; content_type: string; data: unknown }): Promise<string> {
    const asset_id = newId("asset");
    this.assets.set(asset_id, { asset_id, created_at: now(), ...input });
    return asset_id;
  }

  async get(id: string): Promise<StoredAsset | null> {
    return this.assets.get(id) ?? null;
  }
}

/** Filesystem-backed store: one JSON file per asset under `dir`. */
export class FsAssetStore implements AssetStore {
  constructor(private readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async put(input: { scope: AssetScope; content_type: string; data: unknown }): Promise<string> {
    const asset_id = newId("asset");
    const asset: StoredAsset = { asset_id, created_at: now(), ...input };
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(asset_id), JSON.stringify(asset), "utf8");
    return asset_id;
  }

  async get(id: string): Promise<StoredAsset | null> {
    try {
      // Guard against path traversal in the id.
      if (!/^[\w.-]+$/.test(id)) return null;
      return JSON.parse(await readFile(this.path(id), "utf8")) as StoredAsset;
    } catch {
      return null;
    }
  }
}

/** Pick the store from env: ASSET_DIR → filesystem, else in-memory. */
export function assetStoreFromEnv(env: NodeJS.ProcessEnv = process.env): AssetStore {
  return env.ASSET_DIR ? new FsAssetStore(env.ASSET_DIR) : new MemoryAssetStore();
}
