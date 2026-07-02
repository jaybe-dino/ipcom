import { newId } from "../ids.js";
import {
  ACTION_CAPABILITY,
  type GenRequest,
  type JobHandle,
  type JobResult,
  type PluginCapability,
  type RemixPlugin,
} from "./types.js";

/**
 * Higgsfield adapter — connects the Plugin Gateway to Higgsfield's generation
 * API (image / video / music / voice) as a real vendor plugin. Like the NIM
 * adapter it normalizes both synchronous (asset URL) and asynchronous
 * (job id + status polling) responses, and is fully env-gated: with no key the
 * gateway falls back to the stub, so dev never breaks.
 *
 * Env:
 *   HIGGSFIELD_API_KEY   — required to enable.
 *   HIGGSFIELD_BASE_URL  — default https://platform.higgsfield.ai/v1
 *   HIGGSFIELD_STATUS_PATH — poll path template, default "/jobs/{id}".
 */

export type FetchFn = typeof fetch;

export interface HiggsfieldConfig {
  apiKey: string;
  baseUrl: string;
  statusPath: string;
  capabilities: PluginCapability[];
}

export function higgsfieldConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HiggsfieldConfig | null {
  const apiKey = env.HIGGSFIELD_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.HIGGSFIELD_BASE_URL ?? "https://platform.higgsfield.ai/v1",
    statusPath: env.HIGGSFIELD_STATUS_PATH ?? "/jobs/{id}",
    // Higgsfield covers rich media generation out of the box.
    capabilities: ["image", "video", "music", "voice"],
  };
}

interface Pending {
  status: JobResult["status"];
  progress: number;
  output?: string;
  error?: string;
  pollUrl?: string;
}

export class HiggsfieldPlugin implements RemixPlugin {
  readonly id = "higgsfield";
  readonly capabilities: PluginCapability[];
  private jobs = new Map<string, Pending>();

  constructor(
    private readonly config: HiggsfieldConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.capabilities = config.capabilities;
  }

  async submit(req: GenRequest): Promise<JobHandle> {
    const jobId = newId("hf");
    try {
      const capability = ACTION_CAPABILITY[req.action];
      const res = await this.fetchFn(`${this.config.baseUrl}/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: capability,
          prompt: req.prompt,
          input_assets: req.source_assets,
          params: req.params ?? {},
        }),
      });
      if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      this.jobs.set(jobId, this.interpret((await res.json()) as HfResponse));
      return { job_id: jobId, plugin_id: this.id, status: this.jobs.get(jobId)!.status };
    } catch (e) {
      this.jobs.set(jobId, { status: "failed", progress: 0, error: (e as Error).message });
      return { job_id: jobId, plugin_id: this.id, status: "failed" };
    }
  }

  async poll(job: JobHandle): Promise<JobResult> {
    const p = this.jobs.get(job.job_id);
    if (!p) return { status: "failed", progress: 0, error: "unknown_job" };
    if (p.status === "running" && p.pollUrl) {
      const res = await this.fetchFn(p.pollUrl, {
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" },
      });
      if (res.ok) Object.assign(p, this.interpret((await res.json()) as HfResponse));
      else Object.assign(p, { status: "failed", error: `Higgsfield poll ${res.status}` });
    }
    return { status: p.status, progress: p.progress, output: p.output, error: p.error };
  }

  provenance(_output: string, req: GenRequest) {
    return {
      source_assets: req.source_assets,
      model_info: { plugin_id: this.id, model: ACTION_CAPABILITY[req.action], version: "higgsfield" },
      prompt: req.prompt,
    };
  }

  private interpret(data: HfResponse): Pending {
    const asset = data.url ?? data.asset_url ?? data.output?.url ?? data.result?.url;
    if (asset) return { status: "succeeded", progress: 1, output: asset };
    const status = (data.status ?? "").toUpperCase();
    if (["PENDING", "QUEUED", "PROCESSING", "RUNNING"].includes(status)) {
      const id = data.id ?? data.job_id;
      const pollUrl = id ? `${this.config.baseUrl}${this.config.statusPath.replace("{id}", id)}` : undefined;
      return { status: "running", progress: data.progress ?? 0.1, pollUrl };
    }
    return { status: "failed", progress: 0, error: data.error ?? "no_output" };
  }
}

interface HfResponse {
  url?: string;
  asset_url?: string;
  output?: { url?: string };
  result?: { url?: string };
  status?: string;
  id?: string;
  job_id?: string;
  progress?: number;
  error?: string;
}
