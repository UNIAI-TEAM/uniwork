import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export const OfficeDesktopDownloadSchema = z.object({
  installer_url: z.string().url(), server_origin: z.string().url(),
  channel: z.enum(["stable", "beta", "dev"]), client_id: z.string().min(1), deployment_id: z.string().min(1),
}).strict();
export type OfficeDesktopDownload = z.infer<typeof OfficeDesktopDownloadSchema>;

export async function getOfficeDesktopDownload(organizationId: string, channel: OfficeDesktopDownload["channel"] = "stable"): Promise<OfficeDesktopDownload | null> {
  const raw = await request(`/api/v1/office/desktop/download?organization_id=${encodeURIComponent(organizationId)}&channel=${encodeURIComponent(channel)}`);
  return parseWithFallback<OfficeDesktopDownload | null>(raw, OfficeDesktopDownloadSchema, null, { endpoint: "GET /api/v1/office/desktop/download" });
}
