import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * GET /api/v1/config (F-11): the public feature flags for the caller's
 * context and the RUM sample rate. Read once at boot by the web host; a
 * drifted response degrades to "no flags, no sampling" rather than throwing.
 */

const ConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).catch({}),
  rum_sample_rate: z.number().min(0).max(1).catch(0),
});

export interface PublicConfig {
  flags: Record<string, boolean>;
  rum_sample_rate: number;
}

const EMPTY: PublicConfig = { flags: {}, rum_sample_rate: 0 };

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
