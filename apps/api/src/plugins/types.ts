import type { CreativeAction, Provenance } from "@remix-hub/core";

/**
 * REMIX Plugin SDK (PRD §5.1).
 *
 * Every generation engine is integrated as an adapter implementing this
 * interface, so the rights/settlement pipeline stays identical no matter which
 * vendor produced the asset (plugin-agnostic, PRD §1.2). NVIDIA NIM
 * (build.nvidia.com) is the first reference adapter; see ./nim.ts.
 */

export type PluginCapability = "image" | "video" | "music" | "voice" | "3d";

/** Maps a domain CreativeAction to the plugin capability it needs. */
export const ACTION_CAPABILITY: Record<CreativeAction, PluginCapability> = {
  image: "image",
  video_recast: "video",
  music: "music",
  voice: "voice",
  characterize: "image",
};

export interface GenRequest {
  prompt: string;
  source_assets: string[];
  params?: Record<string, unknown>;
  /** Injected by the Rights Engine after a successful G1 evaluation. */
  ip_id: string;
  action: CreativeAction;
  /** Optional async-completion callback (queue mode). */
  callback_url?: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobHandle {
  job_id: string;
  plugin_id: string;
  status: JobStatus;
}

export interface JobResult {
  status: JobStatus;
  progress: number; // 0..1
  /** Output asset reference when status === "succeeded". */
  output?: string;
  error?: string;
}

export interface RemixPlugin {
  id: string;
  capabilities: PluginCapability[];
  /** 1) Submit a generation job. */
  submit(req: GenRequest): Promise<JobHandle>;
  /** 2) Poll status / result. */
  poll(job: JobHandle): Promise<JobResult>;
  /** 3) Rights-metadata hook (mandatory) — produces provenance for the ledger. */
  provenance(output: string, req: GenRequest): Provenance;
}
