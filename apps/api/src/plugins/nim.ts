import { newId } from "../ids.js";
import { ACTION_CAPABILITY, type GenRequest, type JobHandle, type JobResult, type PluginCapability, type RemixPlugin } from "./types.js";

/**
 * NVIDIA NIM adapter (build.nvidia.com) — multi-capability.
 *
 * NIM microservices expose model endpoints under https://ai.api.nvidia.com/v1.
 * Visual/audio models respond either synchronously (artifacts/base64 or a URL)
 * or asynchronously (a request id + status that you poll). This adapter handles
 * both shapes through the standard submit()/poll() SDK contract and supports
 * image / video / music / voice / 3d via per-capability model config.
 *
 * Configuration (env, so no secrets in code):
 *   NVIDIA_API_KEY   — required to enable; absent → adapter disabled (stub failover).
 *   NIM_BASE_URL     — default https://ai.api.nvidia.com/v1
 *   NIM_IMAGE_MODEL / NIM_VIDEO_MODEL / NIM_MUSIC_MODEL / NIM_VOICE_MODEL / NIM_3D_MODEL
 *                    — set a model id to enable that capability. Image defaults to SDXL.
 *   NIM_STATUS_PATH  — async poll path template, default "/status/{id}".
 */

export interface NimModelConfig {
  model: string;
  /** Override the generate endpoint; default `${baseUrl}/genai/${model}`. */
  endpoint?: string;
}

export interface NimConfig {
  apiKey: string;
  baseUrl: string;
  statusPath: string;
  models: Partial<Record<PluginCapability, NimModelConfig>>;
}

/** Inject fetch for testing; defaults to global fetch. */
export type FetchFn = typeof fetch;

export function nimConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NimConfig | null {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  const models: NimConfig["models"] = {};
  const map: [PluginCapability, string | undefined, string?][] = [
    ["image", env.NIM_IMAGE_MODEL, "stabilityai/stable-diffusion-xl"],
    ["video", env.NIM_VIDEO_MODEL],
    ["music", env.NIM_MUSIC_MODEL],
    ["voice", env.NIM_VOICE_MODEL],
    ["3d", env.NIM_3D_MODEL],
  ];
  for (const [cap, model, fallback] of map) {
    const resolved = model ?? fallback;
    if (resolved) models[cap] = { model: resolved };
  }

  return {
    apiKey,
    baseUrl: env.NIM_BASE_URL ?? "https://ai.api.nvidia.com/v1",
    statusPath: env.NIM_STATUS_PATH ?? "/status/{id}",
    models,
  };
}

interface PendingJob {
  status: JobResult["status"];
  progress: number;
  output?: string;
  error?: string;
  /** Async poll URL, if the model returned a request id. */
  pollUrl?: string;
  capability: PluginCapability;
  prompt: string;
}

export class NimPlugin implements RemixPlugin {
  readonly id = "nvidia.nim";
  readonly capabilities: PluginCapability[];
  private jobs = new Map<string, PendingJob>();

  constructor(
    private readonly config: NimConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.capabilities = Object.keys(config.models) as PluginCapability[];
  }

  async submit(req: GenRequest): Promise<JobHandle> {
    const capability = ACTION_CAPABILITY[req.action];
    const model = this.config.models[capability];
    const jobId = newId("nim");
    if (!model) {
      this.jobs.set(jobId, { status: "failed", progress: 0, error: `no_model_for_${capability}`, capability, prompt: req.prompt });
      return { job_id: jobId, plugin_id: this.id, status: "failed" };
    }
    try {
      const result = await this.callModel(model, req, capability);
      this.jobs.set(jobId, { ...result, capability, prompt: req.prompt });
      return { job_id: jobId, plugin_id: this.id, status: result.status };
    } catch (e) {
      this.jobs.set(jobId, { status: "failed", progress: 0, error: (e as Error).message, capability, prompt: req.prompt });
      return { job_id: jobId, plugin_id: this.id, status: "failed" };
    }
  }

  async poll(job: JobHandle): Promise<JobResult> {
    const pending = this.jobs.get(job.job_id);
    if (!pending) return { status: "failed", progress: 0, error: "unknown_job" };
    if (pending.status === "running" && pending.pollUrl) {
      const updated = await this.pollStatus(pending.pollUrl);
      Object.assign(pending, updated);
    }
    return { status: pending.status, progress: pending.progress, output: pending.output, error: pending.error };
  }

  provenance(_output: string, req: GenRequest) {
    const capability = ACTION_CAPABILITY[req.action];
    return {
      source_assets: req.source_assets,
      model_info: { plugin_id: this.id, model: this.config.models[capability]?.model, version: "nim" },
      prompt: req.prompt,
    };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async callModel(
    model: NimModelConfig,
    req: GenRequest,
    capability: PluginCapability,
  ): Promise<{ status: JobResult["status"]; progress: number; output?: string; pollUrl?: string; error?: string }> {
    const url = model.endpoint ?? `${this.config.baseUrl}/genai/${model.model}`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(buildRequestBody(capability, req)),
    });
    if (!res.ok) {
      throw new Error(`NIM ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    }
    const data = (await res.json()) as NimResponse;
    return this.interpret(data, model.model);
  }

  private async pollStatus(pollUrl: string) {
    const res = await this.fetchFn(pollUrl, { headers: this.headers() });
    if (!res.ok) return { status: "failed" as const, progress: 0, error: `NIM poll ${res.status}` };
    return this.interpret((await res.json()) as NimResponse, "");
  }

  /** Normalize the many NIM response shapes into a JobResult-ish object. */
  private interpret(
    data: NimResponse,
    model: string,
  ): { status: JobResult["status"]; progress: number; output?: string; pollUrl?: string } {
    const asset = extractAsset(data, model);
    if (asset) return { status: "succeeded", progress: 1, output: asset };

    const status = (data.status ?? "").toUpperCase();
    if (status === "PENDING" || status === "IN_QUEUE" || status === "RUNNING") {
      const id = data.id ?? data.request_id;
      const pollUrl = id ? `${this.config.baseUrl}${this.config.statusPath.replace("{id}", id)}` : undefined;
      return { status: "running", progress: data.progress ?? 0.1, pollUrl };
    }
    return { status: "failed", progress: 0 };
  }
}

interface NimResponse {
  artifacts?: { base64?: string; url?: string }[];
  url?: string;
  audio?: string;
  video?: string;
  asset_url?: string;
  status?: string;
  id?: string;
  request_id?: string;
  progress?: number;
}

function extractAsset(data: NimResponse, model: string): string | null {
  const art = data.artifacts?.[0];
  if (art?.base64) return `nim-asset://${model}/${art.base64.slice(0, 16)}`;
  return art?.url ?? data.url ?? data.video ?? data.audio ?? data.asset_url ?? null;
}

function buildRequestBody(capability: PluginCapability, req: GenRequest): Record<string, unknown> {
  switch (capability) {
    case "image":
      return { prompt: req.prompt, cfg_scale: 5, steps: 25, samples: 1 };
    case "video":
      return { prompt: req.prompt, image: req.source_assets[0], duration: 4 };
    case "music":
      return { prompt: req.prompt, duration: 15 };
    case "voice":
      return { text: req.prompt, voice: (req.params?.voice as string) ?? "default" };
    case "3d":
      return { prompt: req.prompt, image: req.source_assets[0] };
  }
}
