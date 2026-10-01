import { z } from "zod";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";

export const OfficeDesktopDownloadSchema = z.object({
  installer_url: z.string().url().refine((value) => /^https?:\/\//.test(value)), server_origin: z.string().url().refine((value) => /^https?:\/\//.test(value)),
  channel: z.enum(["stable", "beta", "dev"]), client_id: z.string().min(1), deployment_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
}).superRefine((profile, context) => {
  for (const [key, value] of [["installer_url", profile.installer_url], ["server_origin", profile.server_origin]] as const) {
    let url: URL;
    try { url = new URL(value); }
    catch {
      context.addIssue({ code: "custom", path: [key], message: "invalid deployment URL" });
      continue;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(profile.channel === "dev" && loopback && url.protocol === "http:")) || (key === "server_origin" && url.pathname !== "/")) {
      context.addIssue({ code: "custom", path: [key], message: "unsafe deployment URL" });
    }
  }
  if (profile.client_id !== (profile.channel === "dev" ? "uniwork-office-dev" : "uniwork-office")) context.addIssue({ code: "custom", path: ["client_id"], message: "client does not match channel" });
});
export type OfficeDesktopDownload = z.infer<typeof OfficeDesktopDownloadSchema>;

export async function getOfficeDesktopDownload(organizationId: string, channel: OfficeDesktopDownload["channel"] = "stable"): Promise<OfficeDesktopDownload | null> {
  const raw = await request(`/api/v1/office/desktop/download?organization_id=${encodeURIComponent(organizationId)}&channel=${encodeURIComponent(channel)}`);
  const profile = parseWithFallback<OfficeDesktopDownload | null>(raw, OfficeDesktopDownloadSchema, null, { endpoint: "GET /api/v1/office/desktop/download" });
  return profile?.channel === channel ? profile : null;
}

export async function downloadOfficeDesktopBundle(organizationId: string, channel: OfficeDesktopDownload["channel"]): Promise<Blob> {
  const blob = await requestBlob(`/api/v1/office/desktop/download?organization_id=${encodeURIComponent(organizationId)}&channel=${channel}&bundle=true`);
  if (blob.type !== "application/zip") throw new Error("invalid desktop installer bundle response");
  return blob;
}
