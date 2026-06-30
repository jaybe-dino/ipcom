import type { CreativeAction } from "@remix-hub/core";
import { NimPlugin, nimConfigFromEnv } from "./nim.js";
import { StubPlugin } from "./stub.js";
import { ACTION_CAPABILITY, type GenRequest, type JobResult, type RemixPlugin } from "./types.js";

/**
 * Plugin Gateway (PRD §2.1). Routes a generation request to an adapter that
 * supports the required capability, with failover to the stub adapter when a
 * preferred vendor adapter fails or is unconfigured (PRD §5.2).
 */
export class PluginGateway {
  private readonly stub = new StubPlugin();
  private readonly plugins: RemixPlugin[] = [];

  constructor(plugins: RemixPlugin[] = []) {
    this.plugins = plugins;
  }

  /** Build the default gateway: NVIDIA NIM (if NVIDIA_API_KEY set) → stub failover. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): PluginGateway {
    const plugins: RemixPlugin[] = [];
    const nim = nimConfigFromEnv(env);
    if (nim) plugins.push(new NimPlugin(nim));
    return new PluginGateway(plugins);
  }

  /** Ordered candidate adapters for an action; stub is always the final fallback. */
  private candidates(action: CreativeAction): RemixPlugin[] {
    const cap = ACTION_CAPABILITY[action];
    const preferred = this.plugins.filter((p) => p.capabilities.includes(cap));
    return [...preferred, this.stub];
  }

  /**
   * Run a generation through the first adapter that succeeds. Returns the
   * winning plugin id, the asset reference, and provenance for the ledger.
   */
  async generate(
    req: GenRequest,
  ): Promise<{ plugin_id: string; output: string; provenance: ReturnType<RemixPlugin["provenance"]> }> {
    let lastError = "no_adapter";
    for (const plugin of this.candidates(req.action)) {
      const job = await plugin.submit(req);
      const result: JobResult = await plugin.poll(job);
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
