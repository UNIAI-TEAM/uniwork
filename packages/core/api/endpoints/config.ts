import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { CapabilityState } from "../../capabilities/types";
import { officeInstallerOptions } from "./office-desktop";
import type { OfficeInstallerOption } from "../../office/desktop-platform";

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
const InstallerChannelsSchema = z.object({ dev: z.unknown().optional(), beta: z.unknown().optional(), stable: z.unknown().optional() });
// Store pages open in the visitor's browser: HTTPS without credentials, or "".
const storeURL = z.string().trim().refine((value) => value === "" || /^https:\/\/[^\s/@]+(?:[/?#]\S*)?$/i.test(value)).catch("");
const UniChatStoresSchema = z.object({
  ios: storeURL.optional().default(""),
  android: storeURL.optional().default(""),
  testflight: storeURL.optional().default(""),
  play_internal: storeURL.optional().default(""),
});

const ConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).catch({}),
  rum_sample_rate: z.number().min(0).max(1).catch(0),
  work_management_capabilities: z.record(z.string(), CapabilityEntrySchema).catch({}),
  office_installer_urls: OfficeInstallerURLsSchema.optional(),
  office_installers: InstallerChannelsSchema.optional(),
  office_deployment_id: z.string().trim().min(1).optional(),
  // A drifted origin drops to "absent": links then carry no profile and the app keeps its server.
  office_api_origin: z.string().trim().min(1).optional().catch(undefined),
  // A drifted UniChat block reads as "nothing published", never as a broken config.
  unichat_installers: InstallerChannelsSchema.optional().catch(undefined),
  unichat_stores: UniChatStoresSchema.optional().catch(undefined),
});

type InstallerChannels = { dev: OfficeInstallerOption[]; beta: OfficeInstallerOption[]; stable: OfficeInstallerOption[] };

export interface PublicConfig {
  flags: Record<string, boolean>;
  rum_sample_rate: number;
  work_management_capabilities: Record<string, CapabilityState>;
  /** Older config consumers may omit this optional rollout field. */
  office_installers?: InstallerChannels;
  /** UniChat desktop installers per channel, on Office's platform contract. */
  unichat_installers?: InstallerChannels;
  /** UniChat mobile store pages; "" means that store has nothing published. */
  unichat_stores?: z.infer<typeof UniChatStoresSchema>;
  /** Server-selected deployment binding for Office launch tickets. */
  office_deployment_id?: string;
  /** Public API origin the desktop app signs in to; carried on every web -> app link. */
  office_api_origin?: string;
}

// No guessed fallback here: an id the server never advertised must leave the
// desktop open action closed, not send a possibly-wrong deployment binding.
const NO_STORES = { ios: "", android: "", testflight: "", play_internal: "" };
const EMPTY: PublicConfig = {
  flags: {}, rum_sample_rate: 0, work_management_capabilities: {},
  office_installers: { dev: [], beta: [], stable: [] },
  unichat_installers: { dev: [], beta: [], stable: [] }, unichat_stores: NO_STORES,
};

type WireConfig = Omit<PublicConfig, "office_installers" | "unichat_installers"> & {
  office_installer_urls?: z.infer<typeof OfficeInstallerURLsSchema>;
  office_installers?: z.infer<typeof InstallerChannelsSchema>;
  unichat_installers?: z.infer<typeof InstallerChannelsSchema>;
};

export async function getPublicConfig(organizationId?: string): Promise<PublicConfig> {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  const raw = await request(`/api/v1/config${qs}`, { skipRefresh: true });
  const parsed = parseWithFallback<WireConfig | null>(raw, ConfigSchema, null, { endpoint: "GET /api/v1/config" });
  if (!parsed) return EMPTY;
  const installer = parsed.office_installer_urls ?? { dev: "", beta: "", stable: "" };
  // Singular channel URLs are supported only at this rollout boundary,
  // removed with server legacy env support on 2026-11-02.
  const channels = {} as InstallerChannels;
  const unichat = {} as InstallerChannels;
  for (const channel of ["dev", "beta", "stable"] as const) {
    const rows = parsed.office_installers?.[channel] ?? (installer[channel] ? [{ platform: "win32-x64", kind: ".exe", url: installer[channel] }] : []);
    channels[channel] = officeInstallerOptions(rows, channel);
    unichat[channel] = officeInstallerOptions(parsed.unichat_installers?.[channel] ?? [], channel, "unichat_installers");
  }
  return {
    flags: parsed.flags,
    rum_sample_rate: parsed.rum_sample_rate,
    work_management_capabilities: parsed.work_management_capabilities,
    office_installers: channels,
    office_deployment_id: parsed.office_deployment_id,
    office_api_origin: parsed.office_api_origin,
    unichat_installers: unichat,
    unichat_stores: parsed.unichat_stores ?? NO_STORES,
  };
}

export type WebVitalName = "lcp" | "inp" | "cls" | "ttfb";

/** POST /api/v1/rum: fire-and-forget; the server always answers 204. */
export async function postWebVital(metric: WebVitalName, value: number, route: string): Promise<void> {
  await request("/api/v1/rum", { method: "POST", body: { metric, value, route }, skipRefresh: true });
}
