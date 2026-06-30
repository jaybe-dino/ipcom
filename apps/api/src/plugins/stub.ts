import { newId } from "../ids.js";
import type { GenRequest, JobHandle, JobResult, PluginCapability, RemixPlugin } from "./types.js";

/**
 * Local stub adapter — deterministic, no external calls. Used as the default
 * and as a failover target when a vendor adapter is unavailable (PRD §5.2).
 */
export class StubPlugin implements RemixPlugin {
  readonly id: string;
  readonly capabilities: PluginCapability[];

  constructor(id = "stub.local", capabilities: PluginCapability[] = ["image", "video", "music", "voice", "3d"]) {
    this.id = id;
    this.capabilities = capabilities;
  }

  async submit(_req: GenRequest): Promise<JobHandle> {
    return { job_id: newId("job"), plugin_id: this.id, status: "succeeded" };
  }

  async poll(job: JobHandle): Promise<JobResult> {
    return { status: "succeeded", progress: 1, output: `asset://${job.job_id}/output` };
  }

  provenance(output: string, req: GenRequest) {
    return {
      source_assets: req.source_assets,
      model_info: { plugin_id: this.id, model: "stub" },
      prompt: req.prompt,
    };
  }
}
