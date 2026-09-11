import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { CapabilityState } from "../../capabilities/types";

/**
 * GET /api/v1/config (F-11): the public feature flags for the caller's
 * context, the RUM sample rate, and Work Management capabilities. Read once
 * at boot by the web host; a drifted response degrades to "no flags, no
 * sampling, no capabilities" rather than throwing.
 */

const CapabilityEntrySchema = z
  .object({
    status: z.string(),
    reason_code: z.string().optional().default(""),
    explanation_key: z.string().optional().default(""),
  })
  .refine((entry) => entry.status === "available" || entry.status === "unavailable");

const ConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).catch({}),
  rum_sample_rate: z.number().min(0).max(1).catch(0),
  work_management_capabilities: z.record(z.string(), CapabilityEntrySchema).catch({}),
});

export interface PublicConfig {
  flags: Record<string, boolean>;
  rum_sample_rate: number;
  work_management_capabilities: Record<string, CapabilityState>;
}

const EMPTY: PublicConfig = { flags: {}, rum_sample_rate: 0, work_management_capabilities: {} };

export async function getPublicConfig(organizationId?: string): Promise<PublicConfig> {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  const raw = await request(`/api/v1/config${qs}`, { skipRefresh: true });
  return parseWithFallback<PublicConfig>(raw, ConfigSchema, EMPTY, { endpoint: "GET /api/v1/config" });
}

export type WebVitalName = "lcp" | "inp" | "cls" | "ttfb";

/** POST /api/v1/rum: fire-and-forget; the server always answers 204. */
export async function postWebVital(metric: WebVitalName, value: number, route: string): Promise<void> {
  await request("/api/v1/rum", { method: "POST", body: { metric, value, route }, skipRefresh: true });
}
