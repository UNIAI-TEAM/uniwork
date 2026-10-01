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

// Empty is a valid deployment value: it is rendered as an unavailable
// installer rather than guessed from the app origin. Only HTTP(S) URLs are
// accepted so a config drift cannot turn the install CTA into an
// arbitrary protocol launch.
const installerURL = z.string().trim().refine((value) => value === "" || /^https?:\/\/[^\s]+$/i.test(value)).catch("");
const OfficeInstallerURLsSchema = z.object({
  dev: installerURL.optional().default(""),
  beta: installerURL.optional().default(""),
  stable: installerURL.optional().default(""),
});

const ConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).catch({}),
  rum_sample_rate: z.number().min(0).max(1).catch(0),
  work_management_capabilities: z.record(z.string(), CapabilityEntrySchema).catch({}),
  office_installer_urls: OfficeInstallerURLsSchema.optional(),
  office_deployment_id: z.string().trim().min(1).optional(),
});

export interface PublicConfig {
  flags: Record<string, boolean>;
  rum_sample_rate: number;
  work_management_capabilities: Record<string, CapabilityState>;
  /** Older config consumers may omit this optional rollout field. */
  office_installer_urls?: { dev: string; beta: string; stable: string };
  /** Server-selected deployment binding for Office launch tickets. */
  office_deployment_id?: string;
}

// No guessed fallback here: an id the server never advertised must leave the
// desktop open action closed, not send a possibly-wrong deployment binding.
const EMPTY: PublicConfig = {
  flags: {}, rum_sample_rate: 0, work_management_capabilities: {},
  office_installer_urls: { dev: "", beta: "", stable: "" },
};

export async function getPublicConfig(organizationId?: string): Promise<PublicConfig> {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  const raw = await request(`/api/v1/config${qs}`, { skipRefresh: true });
  const parsed = parseWithFallback<PublicConfig | null>(raw, ConfigSchema, null, { endpoint: "GET /api/v1/config" });
  if (!parsed) return EMPTY;
  const installer = parsed.office_installer_urls ?? { dev: "", beta: "", stable: "" };
  return {
    flags: parsed.flags,
    rum_sample_rate: parsed.rum_sample_rate,
    work_management_capabilities: parsed.work_management_capabilities,
    office_installer_urls: { dev: installer.dev ?? "", beta: installer.beta ?? "", stable: installer.stable ?? "" },
    office_deployment_id: parsed.office_deployment_id,
  };
}

export type WebVitalName = "lcp" | "inp" | "cls" | "ttfb";

/** POST /api/v1/rum: fire-and-forget; the server always answers 204. */
export async function postWebVital(metric: WebVitalName, value: number, route: string): Promise<void> {
  await request("/api/v1/rum", { method: "POST", body: { metric, value, route }, skipRefresh: true });
}
