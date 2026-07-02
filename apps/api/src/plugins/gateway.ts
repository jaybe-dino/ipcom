import type { CreativeAction } from "@remix-hub/core";
import { HiggsfieldPlugin, higgsfieldConfigFromEnv } from "./higgsfield.js";
import { NimPlugin, nimConfigFromEnv } from "./nim.js";
import { StubPlugin } from "./stub.js";
import { ACTION_CAPABILITY, type GenRequest, type JobResult, type RemixPlugin } from "./types.js";

export interface GatewayOptions {
  /** Max poll attempts for async jobs before giving up. */
  maxPolls?: number;
  /** Sleep between polls (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Delay between polls in ms. */
  pollDelayMs?: number;
}

/**
 * Plugin Gateway (PRD §2.1). Routes a generation request to an adapter that
 * supports the required capability, polls async jobs to completion, and fails
 * over to the stub adapter when a vendor adapter errors or is unconfigured
 * (PRD §5.2).
 */
export class PluginGateway {
  private readonly stub = new StubPlugin();
  private readonly plugins: RemixPlugin[];
  private readonly maxPolls: number;
  private readonly pollDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(plugins: RemixPlugin[] = [], opts: GatewayOptions = {}) {
    this.plugins = plugins;
    this.maxPolls = opts.maxPolls ?? 30;
    this.pollDelayMs = opts.pollDelayMs ?? 1000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Build the default gateway: NVIDIA NIM (if NVIDIA_API_KEY set) → stub failover. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): PluginGateway {
    const plugins: RemixPlugin[] = [];
    const hf = higgsfieldConfigFromEnv(env);
    if (hf) plugins.push(new HiggsfieldPlugin(hf));
    const nim = nimConfigFromEnv(env);
    if (nim) plugins.push(new NimPlugin(nim));
    return new PluginGateway(plugins);
  }

  /** Adapter inventory for status/UX (which capabilities each adapter serves). */
  describe(): { plugins: { id: string; capabilities: string[] }[] } {
    return {
      plugins: [...this.plugins, this.stub].map((p) => ({ id: p.id, capabilities: p.capabilities })),
    };
  }

  /**
   * Ordered candidate adapters for an action; stub is always the final fallback.
   * A user-selected `preferredId` is tried first (if it serves the capability).
   */
  private candidates(action: CreativeAction, preferredId?: string): RemixPlugin[] {
    const cap = ACTION_CAPABILITY[action];
    const capable = this.plugins.filter((p) => p.capabilities.includes(cap));
    const ordered = preferredId
      ? [...capable.filter((p) => p.id === preferredId), ...capable.filter((p) => p.id !== preferredId)]
      : capable;
    return [...ordered, this.stub];
  }

  /** Submit + poll one adapter until the job reaches a terminal state. */
  private async runOne(plugin: RemixPlugin, req: GenRequest): Promise<JobResult> {
    const job = await plugin.submit(req);
    let result = await plugin.poll(job);
    let attempts = 0;
    while (result.status === "queued" || result.status === "running") {
      if (attempts++ >= this.maxPolls) return { status: "failed", progress: result.progress, error: "poll_timeout" };
      await this.sleep(this.pollDelayMs);
      result = await plugin.poll(job);
    }
    return result;
  }

  /**
   * Run a generation through the first adapter that succeeds. Returns the
   * winning plugin id, the asset reference, and provenance for the ledger.
   */
  async generate(
    req: GenRequest,
  ): Promise<{ plugin_id: string; output: string; provenance: ReturnType<RemixPlugin["provenance"]> }> {
    let lastError = "no_adapter";
    for (const plugin of this.candidates(req.action, req.preferred_plugin_id)) {
      const result = await this.runOne(plugin, req);
      if (result.status === "succeeded" && result.output) {
        return {
          plugin_id: plugin.id,
          output: result.output,
          provenance: plugin.provenance(result.output, req),
        };
      }
      lastError = result.error ?? "failed";
    }
    throw new Error(`all_adapters_failed: ${lastError}`);
  }
}
