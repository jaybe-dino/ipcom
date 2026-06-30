import { newId, now } from "../ids.js";

/**
 * Asset storage (PRD §2.1 Asset Storage/CDN). Separates internal vs export
 * access (NFR: 자산 접근권 분리). The MVP uses an in-memory store; production
 * swaps in S3/GCS + CDN behind the same interface. License manifests are stored
 * as `export`-scoped assets; raw generation outputs as `internal`.
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
