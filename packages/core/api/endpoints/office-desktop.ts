import { z } from "zod";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";
import { DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, isDesktopPlatform, type DesktopPlatform, type OfficeInstallerOption } from "../../office/desktop-platform";
import type { OfficeChannel } from "../../office/desktop-handoff";

function safeURL(value: string, channel: string, originOnly = false): boolean {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username && !url.password && !url.search && !url.hash && !/\s/.test(value)
      && (url.protocol === "https:" || (channel === "dev" && loopback && url.protocol === "http:"))
      && (!originOnly || url.pathname === "/");
  } catch { return false; }
}

const InstallerSchema = z.object({
  platform: z.string(), url: z.string(), kind: z.string(),
  size_bytes: z.number().int().positive().optional(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  version: z.string().min(1).optional(), unsigned: z.boolean().optional(), requirements: z.string().min(1).optional(),
});

// Unknown platform rows are API drift, not new UI choices. Malformed known
// rows still fail closed; no unsafe installer survives the boundary.
const InstallersSchema = z.preprocess((value) => Array.isArray(value) ? value.filter((row: unknown) => {
  if (!row || typeof row !== "object" || !("platform" in row) || typeof row.platform !== "string") return true;
  return isDesktopPlatform(row.platform);
}) : value, z.array(InstallerSchema));

export const OfficeDesktopDownloadSchema = z.object({
  installers: InstallersSchema.optional(), supported_platforms: z.array(z.string()).optional(),
  // API compatibility only, remove with legacy server _URL on 2026-11-02.
  installer_url: z.string().optional(), server_origin: z.string(),
  channel: z.string(), client_id: z.string().min(1), deployment_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
}).superRefine((profile, context) => {
  if (!["stable", "beta", "dev"].includes(profile.channel) || !safeURL(profile.server_origin, profile.channel, true)) {
    context.addIssue({ code: "custom", message: "unsafe deployment profile" });
  }
  if (!profile.installers && (!profile.installer_url || !safeURL(profile.installer_url, profile.channel))) {
    context.addIssue({ code: "custom", message: "missing or unsafe installers" });
  }
  const seen = new Set<string>();
  for (const row of profile.installers ?? []) {
    if (!isDesktopPlatform(row.platform) || !safeURL(row.url, profile.channel) || seen.has(row.platform)) {
      context.addIssue({ code: "custom", message: "unsafe installer" });
      continue;
    }
    seen.add(row.platform);
    const kind = DESKTOP_INSTALLER_KINDS[row.platform].kind;
    if (row.kind !== kind || !new URL(row.url).pathname.endsWith(kind)) context.addIssue({ code: "custom", message: "installer format mismatch" });
  }
  if (profile.client_id !== (profile.channel === "dev" ? "uniwork-office-dev" : "uniwork-office")) context.addIssue({ code: "custom", message: "client does not match channel" });
});

interface WireDownload {
  installers?: z.infer<typeof InstallerSchema>[];
  supported_platforms?: string[];
  installer_url?: string;
  server_origin: string; channel: OfficeChannel; client_id: string; deployment_id: string;
}

export interface OfficeDesktopDownload {
  installers: OfficeInstallerOption[];
  supported_platforms: DesktopPlatform[];
  server_origin: string; channel: OfficeChannel; client_id: string; deployment_id: string;
}

/** Normalize the public config catalogue at the API boundary as well. */
export function officeInstallerOptions(raw: unknown, channel: OfficeChannel): OfficeInstallerOption[] {
  const rows = parseWithFallback<z.infer<typeof InstallerSchema>[]>(raw, InstallersSchema, [], { endpoint: "GET /api/v1/config office_installers" });
  const options: OfficeInstallerOption[] = [];
  for (const platform of DESKTOP_PLATFORMS) {
    const row = rows.find((item) => item.platform === platform);
    const kind = DESKTOP_INSTALLER_KINDS[platform].kind;
    if (row && safeURL(row.url, channel) && row.kind === kind && new URL(row.url).pathname.endsWith(kind)) options.push({ ...row, platform, channel });
  }
  return options;
}

export async function getOfficeDesktopDownload(organizationId: string, channel: OfficeChannel = "stable"): Promise<OfficeDesktopDownload | null> {
  const raw = await request(`/api/v1/office/desktop/download?organization_id=${encodeURIComponent(organizationId)}&channel=${encodeURIComponent(channel)}`);
  const profile = parseWithFallback<WireDownload | null>(raw, OfficeDesktopDownloadSchema, null, { endpoint: "GET /api/v1/office/desktop/download" });
  if (!profile || profile.channel !== channel) return null;
  const supported = profile.supported_platforms?.filter(isDesktopPlatform) ?? DESKTOP_PLATFORMS;
  const rows = profile.installers ?? [{ platform: "win32-x64", url: profile.installer_url ?? "", kind: ".exe" }];
  const installers: OfficeInstallerOption[] = [];
  for (const platform of DESKTOP_PLATFORMS) {
    const row = rows.find((item) => item.platform === platform);
    if (row && supported.includes(platform)) installers.push({ ...row, platform, channel });
  }
  return { installers, supported_platforms: supported, server_origin: profile.server_origin, channel, client_id: profile.client_id, deployment_id: profile.deployment_id };
}

export async function downloadOfficeDesktopBundle(organizationId: string, channel: OfficeChannel, platform: DesktopPlatform): Promise<Blob> {
  const blob = await requestBlob(`/api/v1/office/desktop/download?organization_id=${encodeURIComponent(organizationId)}&channel=${encodeURIComponent(channel)}&bundle=true&platform=${encodeURIComponent(platform)}`);
  if (blob.type !== "application/zip") throw new Error("invalid desktop installer bundle response");
  return blob;
}
