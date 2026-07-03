import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/** The G-DRAGON sample space ships with browsable example content. */
describe("GD sample space", () => {
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("exposes the space with all channel types", async () => {
    const res = await app.inject({ method: "GET", url: "/spaces/space_gd" });
    expect(res.statusCode).toBe(200);
    const { space, ip, channels } = res.json();
    expect(space.name).toContain("G-DRAGON");
    expect(ip.verification).toBe("official");
    const types = new Set(channels.map((c: { type: string }) => c.type));
    expect(types).toEqual(new Set(["community", "creation", "market"]));
    expect(channels.length).toBe(8);
  });

  it("seeds example creations posted to their channels", async () => {
    const fashion = await app.inject({ method: "GET", url: "/channels/ch_gd_fashion/posts" });
    const body = fashion.json();
    expect(body.posts.length).toBeGreaterThanOrEqual(1);
    expect(body.creations.some((c: { creation_id: string }) => c.creation_id === "cr_gd_couture")).toBe(true);
  });

  it("wires a remix lineage: daisy v2 traces back to the original", async () => {
    const res = await app.inject({ method: "GET", url: "/generations/cr_gd_daisy_v2/lineage" });
    expect(res.statusCode).toBe(200);
    const { ancestors, children } = res.json();
    expect(ancestors.map((a: { creation_id: string }) => a.creation_id)).toContain("cr_gd_daisy");
    // The original in turn lists the v2 remix as a child.
    const root = await app.inject({ method: "GET", url: "/generations/cr_gd_daisy/lineage" });
    expect(root.json().children.map((c: { creation_id: string }) => c.creation_id)).toContain("cr_gd_daisy_v2");
    expect(children).toBeDefined();
  });
});
