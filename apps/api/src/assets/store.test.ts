import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore, MemoryAssetStore, assetStoreFromEnv } from "./store.js";

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

describe("assetStoreFromEnv", () => {
  it("defaults to in-memory and uses FS when ASSET_DIR is set", () => {
    expect(assetStoreFromEnv({})).toBeInstanceOf(MemoryAssetStore);
    expect(assetStoreFromEnv({ ASSET_DIR: "/tmp/x" })).toBeInstanceOf(FsAssetStore);
  });
});
