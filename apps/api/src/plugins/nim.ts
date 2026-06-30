import { newId } from "../ids.js";
import type {
  GenRequest,
  JobHandle,
  JobResult,
  PluginCapability,
  RemixPlugin,
} from "./types.js";

/**
 * NVIDIA NIM reference adapter (build.nvidia.com).
 *
 * NIM microservices expose model endpoints under https://ai.api.nvidia.com/v1
 * (and OpenAI-compatible LLM endpoints under https://integrate.api.nvidia.com/v1).
 * This adapter targets the visual-generation NIMs (e.g. SDXL) which respond
 * synchronously with base64 artifacts; we persist the artifact reference and
 * surface it through the standard submit()/poll() SDK contract.
 *
 * Configuration (all via env, so no secrets live in code):
 *   NVIDIA_API_KEY   — required to make live calls; absent → adapter disabled.
 *   NIM_BASE_URL     — default https://ai.api.nvidia.com/v1
 *   NIM_IMAGE_MODEL  — default stabilityai/stable-diffusion-xl
 *
 * When the key is missing or a call fails, the gateway falls back to the stub
 * adapter (PRD §5.2 multi-vendor failover), so local/dev never hard-breaks.
 */

export interface NimConfig {
  apiKey: string;
  baseUrl: string;
  imageModel: string;
}

export function nimConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NimConfig | null {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.NIM_BASE_URL ?? "https://ai.api.nvidia.com/v1",
    imageModel: env.NIM_IMAGE_MODEL ?? "stabilityai/stable-diffusion-xl",
  };
}

export class NimPlugin implements RemixPlugin {
  readonly id = "nvidia.nim";
  readonly capabilities: PluginCapability[] = ["image"];

  // Holds completed results between submit() and poll().
  private results = new Map<string, JobResult>();

  constructor(private readonly config: NimConfig) {}

  async submit(req: GenRequest): Promise<JobHandle> {
    const jobId = newId("nim");
    try {
      const output = await this.callImage(req.prompt);
      this.results.set(jobId, { status: "succeeded", progress: 1, output });
      return { job_id: jobId, plugin_id: this.id, status: "succeeded" };
    } catch (e) {
      this.results.set(jobId, { status: "failed", progress: 0, error: (e as Error).message });
      return { job_id: jobId, plugin_id: this.id, status: "failed" };
    }
  }

  async poll(job: JobHandle): Promise<JobResult> {
    return this.results.get(job.job_id) ?? { status: "failed", progress: 0, error: "unknown_job" };
  }

  provenance(_output: string, req: GenRequest) {
    return {
      source_assets: req.source_assets,
      model_info: { plugin_id: this.id, model: this.config.imageModel, version: "nim" },
      prompt: req.prompt,
    };
  }

  /** POST to the NIM visual-generation endpoint and return an asset reference. */
  private async callImage(prompt: string): Promise<string> {
    const url = `${this.config.baseUrl}/genai/${this.config.imageModel}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        // Conservative defaults; the Plugin Gateway can override via params.
        cfg_scale: 5,
        steps: 25,
        samples: 1,
      }),
    });
    if (!res.ok) {
      throw new Error(`NIM ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    const data = (await res.json()) as { artifacts?: { base64?: string }[] };
    const b64 = data.artifacts?.[0]?.base64;
    if (!b64) throw new Error("NIM response missing artifact");
    // In production this is uploaded to Asset Storage; here we return a stable ref.
    return `nim-asset://${this.config.imageModel}/${b64.slice(0, 16)}`;
  }
}
