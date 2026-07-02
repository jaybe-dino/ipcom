import { createHash, createHmac } from "node:crypto";
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
 * - S3AssetStore: object storage + CDN (S3 / R2 / MinIO / GCS-interop) for
 *   horizontal scale. Same interface, drops in when S3_BUCKET is set.
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

export type FetchFn = typeof fetch;

export interface S3Config {
  bucket: string;
  region?: string;
  /** S3-compatible endpoint (R2/MinIO/GCS). Defaults to AWS S3 for the region. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix within the bucket (e.g. "remixhub/"). */
  prefix?: string;
}

const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * S3/CDN-backed store. Each asset is a JSON object under `${prefix}${id}.json`.
 * Signs requests with AWS Signature V4 using node:crypto only — no SDK — so it
 * works against S3, Cloudflare R2, MinIO, and GCS interop with just credentials.
 * `fetchFn` is injectable for tests.
 */
export class S3AssetStore implements AssetStore {
  private readonly region: string;
  private readonly host: string;
  private readonly baseUrl: string;
  private readonly prefix: string;

  constructor(
    private readonly cfg: S3Config,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.region = cfg.region ?? "us-east-1";
    const endpoint = cfg.endpoint ?? `https://s3.${this.region}.amazonaws.com`;
    const url = new URL(endpoint);
    this.host = url.host;
    // Path-style addressing (bucket in the path) — most portable across vendors.
    this.baseUrl = `${url.protocol}//${url.host}/${cfg.bucket}`;
    this.prefix = cfg.prefix ?? "";
  }

  private key(id: string): string {
    return `${this.prefix}${id}.json`;
  }

  /** Build an AWS SigV4 Authorization header for one request. */
  private sign(method: "PUT" | "GET", key: string, payload: string, amzDate: string): Record<string, string> {
    const date = amzDate.slice(0, 8);
    const payloadHash = hex(payload);
    const canonicalUri = `/${this.cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const canonicalHeaders =
      `host:${this.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonicalRequest)].join("\n");
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, date);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    return {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
  }

  private amzDate(): string {
    // 20240101T000000Z — no separators, UTC.
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  }

  async put(input: { scope: AssetScope; content_type: string; data: unknown }): Promise<string> {
    const asset_id = newId("asset");
    const asset: StoredAsset = { asset_id, created_at: now(), ...input };
    const body = JSON.stringify(asset);
    const key = this.key(asset_id);
    const headers = this.sign("PUT", key, body, this.amzDate());
    const res = await this.fetchFn(`${this.baseUrl}/${key}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`s3_put_${res.status}`);
    return asset_id;
  }

  async get(id: string): Promise<StoredAsset | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    const key = this.key(id);
    const headers = this.sign("GET", key, "", this.amzDate());
    const res = await this.fetchFn(`${this.baseUrl}/${key}`, { method: "GET", headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`s3_get_${res.status}`);
    return (await res.json()) as StoredAsset;
  }
}

/**
 * Pick the store from env, most-durable first:
 *   S3_BUCKET (+ keys) → object storage/CDN
 *   ASSET_DIR          → filesystem (volume)
 *   else               → in-memory (dev/test)
 */
export function assetStoreFromEnv(env: NodeJS.ProcessEnv = process.env): AssetStore {
  if (env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return new S3AssetStore({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      prefix: env.S3_PREFIX,
    });
  }
  return env.ASSET_DIR ? new FsAssetStore(env.ASSET_DIR) : new MemoryAssetStore();
}
