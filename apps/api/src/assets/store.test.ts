import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FsAssetStore, MemoryAssetStore, S3AssetStore, assetStoreFromEnv } from "./store.js";

describe("FsAssetStore", () => {
  it("persists and reads assets across instances (survives restart)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "remixhub-assets-"));
    const a = new FsAssetStore(dir);
    const id = await a.put({ scope: "export", content_type: "application/json", data: { hello: "world" } });

    // A fresh instance (simulating a restart) reads the same file.
    const b = new FsAssetStore(dir);
    const got = await b.get(id);
    expect(got?.scope).toBe("export");
    expect((got?.data as { hello: string }).hello).toBe("world");
  });

  it("returns null for unknown ids and rejects path traversal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "remixhub-assets-"));
    const a = new FsAssetStore(dir);
    expect(await a.get("nope")).toBeNull();
    expect(await a.get("../../etc/passwd")).toBeNull();
  });
});

describe("S3AssetStore", () => {
  /** Minimal in-memory bucket that also asserts SigV4 headers are present. */
  function fakeS3() {
    const objects = new Map<string, string>();
    const calls: { method: string; url: string; auth: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ method: init.method as string, url, auth: headers.Authorization });
      const key = new URL(url).pathname;
      if (init.method === "PUT") {
        objects.set(key, init.body as string);
        return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
      }
      const body = objects.get(key);
      if (body === undefined) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
      }
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body } as Response;
    });
    return { fetchFn, calls };
  }

  const cfg = {
    bucket: "remix-assets",
    region: "ap-northeast-2",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret",
    prefix: "lic/",
  };

  it("round-trips an asset through a signed PUT + GET", async () => {
    const { fetchFn, calls } = fakeS3();
    const s3 = new S3AssetStore(cfg, fetchFn as unknown as typeof fetch);
    const id = await s3.put({ scope: "export", content_type: "application/json", data: { manifest: 42 } });
    const got = await s3.get(id);
    expect(got?.scope).toBe("export");
    expect((got?.data as { manifest: number }).manifest).toBe(42);

    // Path-style URL, prefix applied, and a SigV4 Authorization header on both.
    expect(calls[0]!.url).toContain(`/remix-assets/lic/${id}.json`);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/\d{8}\/ap-northeast-2\/s3\/aws4_request/);
    expect(calls[0]!.auth).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
  });

  it("returns null on a 404 and rejects path traversal", async () => {
    const { fetchFn } = fakeS3();
    const s3 = new S3AssetStore(cfg, fetchFn as unknown as typeof fetch);
    expect(await s3.get("asset_missing")).toBeNull();
    expect(await s3.get("../../secret")).toBeNull();
  });

  it("targets a custom S3-compatible endpoint (R2/MinIO)", async () => {
    const { fetchFn, calls } = fakeS3();
    const s3 = new S3AssetStore(
      { ...cfg, endpoint: "https://abc123.r2.cloudflarestorage.com" },
      fetchFn as unknown as typeof fetch,
    );
    await s3.put({ scope: "internal", content_type: "application/json", data: {} });
    expect(calls[0]!.url).toContain("abc123.r2.cloudflarestorage.com/remix-assets/lic/");
  });
});

describe("assetStoreFromEnv", () => {
  it("defaults to in-memory and uses FS when ASSET_DIR is set", () => {
    expect(assetStoreFromEnv({})).toBeInstanceOf(MemoryAssetStore);
    expect(assetStoreFromEnv({ ASSET_DIR: "/tmp/x" })).toBeInstanceOf(FsAssetStore);
  });

  it("prefers S3 when bucket + credentials are set", () => {
    const store = assetStoreFromEnv({
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    });
    expect(store).toBeInstanceOf(S3AssetStore);
  });
});
