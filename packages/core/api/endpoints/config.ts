import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import type { CapabilityState } from "../../capabilities/types";
import { officeInstallerOptions } from "./office-desktop";
import type { OfficeInstallerOption } from "../../office/desktop-platform";

/**
 * GET /api/v1/config (F-11): the public feature flags for the caller's
 * context, the RUM sample rate, Work Management capabilities, and document
 * size limits. Read once at boot by the web host; a drifted response degrades
 * to safe defaults rather than throwing.
 */

export const DEFAULT_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_DOCUMENT_SAVE_WARN_RATIO = 0.9;

interface DocumentWebOpenLimit {
  warn_bytes: number;
}

interface DocumentWebOpenLimits {
  docx: DocumentWebOpenLimit;
  pptx: DocumentWebOpenLimit;
  pdf: DocumentWebOpenLimit;
  xlsx: DocumentWebOpenLimit;
}

export interface DocumentLimits {
  upload_max_bytes: number;
  save_warn_ratio: number;
  web_open: DocumentWebOpenLimits;
  chunked_upload_threshold_bytes?: number;
}

const DEFAULT_DOCUMENT_WEB_OPEN_LIMITS: DocumentWebOpenLimits = {
  docx: { warn_bytes: 31_457_280 },
  pptx: { warn_bytes: 26_214_400 },
  pdf: { warn_bytes: 52_428_800 },
  xlsx: { warn_bytes: 5_242_880 },
};

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = {
  upload_max_bytes: DEFAULT_DOCUMENT_MAX_BYTES,
  save_warn_ratio: DEFAULT_DOCUMENT_SAVE_WARN_RATIO,
  web_open: DEFAULT_DOCUMENT_WEB_OPEN_LIMITS,
};

const positiveIntField = z.number().int().positive().optional().catch(undefined);
const warnRatioField = z.number().gt(0).lte(1).optional().catch(undefined);

function webOpenFormatSchema(defaultWarnBytes: number) {
  return z
    .object({ warn_bytes: positiveIntField })
    .optional()
    .catch(undefined)
    .transform((entry): DocumentWebOpenLimit => ({
      warn_bytes: entry?.warn_bytes ?? defaultWarnBytes,
    }));
}

const DocumentWebOpenSchema = z
  .object({
    docx: webOpenFormatSchema(DEFAULT_DOCUMENT_WEB_OPEN_LIMITS.docx.warn_bytes),
    pptx: webOpenFormatSchema(DEFAULT_DOCUMENT_WEB_OPEN_LIMITS.pptx.warn_bytes),
    pdf: webOpenFormatSchema(DEFAULT_DOCUMENT_WEB_OPEN_LIMITS.pdf.warn_bytes),
    xlsx: webOpenFormatSchema(DEFAULT_DOCUMENT_WEB_OPEN_LIMITS.xlsx.warn_bytes),
  })
  .optional()
  .catch(undefined)
  .transform((webOpen): DocumentWebOpenLimits => webOpen ?? DEFAULT_DOCUMENT_WEB_OPEN_LIMITS);

const DocumentLimitsSchema = z
  .object({
    upload_max_bytes: positiveIntField,
    save_warn_ratio: warnRatioField,
    chunked_upload_threshold_bytes: positiveIntField,
    web_open: DocumentWebOpenSchema,
  })
  .optional()
  .catch(undefined)
  .transform((limits): DocumentLimits => ({
    upload_max_bytes: limits?.upload_max_bytes ?? DEFAULT_DOCUMENT_MAX_BYTES,
    save_warn_ratio: limits?.save_warn_ratio ?? DEFAULT_DOCUMENT_SAVE_WARN_RATIO,
    ...(limits?.chunked_upload_threshold_bytes !== undefined
      ? { chunked_upload_threshold_bytes: limits.chunked_upload_threshold_bytes }
      : {}),
    web_open: limits?.web_open ?? DEFAULT_DOCUMENT_WEB_OPEN_LIMITS,
  }));

const DocumentsConfigSchema = z
  .object({
    limits: DocumentLimitsSchema,
  })
  .optional()
  .catch(undefined)
  .transform((docs) => ({
    limits: docs?.limits ?? DEFAULT_DOCUMENT_LIMITS,
  }));

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

const ConfigSchema = z.object({
  flags: z.record(z.string(), z.boolean()).catch({}),
  rum_sample_rate: z.number().min(0).max(1).catch(0),
  work_management_capabilities: z.record(z.string(), CapabilityEntrySchema).catch({}),
  office_installer_urls: OfficeInstallerURLsSchema.optional(),
  office_installers: InstallerChannelsSchema.optional(),
  office_deployment_id: z.string().trim().min(1).optional(),
  // A drifted origin drops to "absent": links then carry no profile and the app keeps its server.
  office_api_origin: z.string().trim().min(1).optional().catch(undefined),
  documents: DocumentsConfigSchema,
});

export interface PublicConfig {
  flags: Record<string, boolean>;
  rum_sample_rate: number;
  work_management_capabilities: Record<string, CapabilityState>;
  /** Older config consumers may omit this optional rollout field. */
  office_installers?: { dev: OfficeInstallerOption[]; beta: OfficeInstallerOption[]; stable: OfficeInstallerOption[] };
  /** Server-selected deployment binding for Office launch tickets. */
  office_deployment_id?: string;
  /** Public API origin the desktop app signs in to; carried on every web -> app link. */
  office_api_origin?: string;
  /** System-wide document size limits and web-open thresholds (SIZE-W1a). */
  documents?: { limits: DocumentLimits };
}

// No guessed fallback here: an id the server never advertised must leave the
// desktop open action closed, not send a possibly-wrong deployment binding.
const EMPTY: PublicConfig = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
  office_installers: { dev: [], beta: [], stable: [] },
  documents: { limits: DEFAULT_DOCUMENT_LIMITS },
};

type WireConfig = Omit<PublicConfig, "office_installers"> & {
  office_installer_urls?: z.infer<typeof OfficeInstallerURLsSchema>;
  office_installers?: z.infer<typeof InstallerChannelsSchema>;
};

export async function getPublicConfig(organizationId?: string): Promise<PublicConfig> {
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  const raw = await request(`/api/v1/config${qs}`, { skipRefresh: true });
  const parsed = parseWithFallback<WireConfig | null>(raw, ConfigSchema, null, { endpoint: "GET /api/v1/config" });
  if (!parsed) return EMPTY;
  const installer = parsed.office_installer_urls ?? { dev: "", beta: "", stable: "" };
  // Singular channel URLs are supported only at this rollout boundary,
  // removed with server legacy env support on 2026-11-02.
  const channels = {} as NonNullable<PublicConfig["office_installers"]>;
  for (const channel of ["dev", "beta", "stable"] as const) {
    const rows = parsed.office_installers?.[channel] ?? (installer[channel] ? [{ platform: "win32-x64", kind: ".exe", url: installer[channel] }] : []);
    channels[channel] = officeInstallerOptions(rows, channel);
  }
  return {
    flags: parsed.flags,
    rum_sample_rate: parsed.rum_sample_rate,
    work_management_capabilities: parsed.work_management_capabilities,
    office_installers: channels,
    office_deployment_id: parsed.office_deployment_id,
    office_api_origin: parsed.office_api_origin,
    documents: parsed.documents ?? { limits: DEFAULT_DOCUMENT_LIMITS },
  };
}

export type WebVitalName = "lcp" | "inp" | "cls" | "ttfb";

/** POST /api/v1/rum: fire-and-forget; the server always answers 204. */
export async function postWebVital(metric: WebVitalName, value: number, route: string): Promise<void> {
  await request("/api/v1/rum", { method: "POST", body: { metric, value, route }, skipRefresh: true });
}
