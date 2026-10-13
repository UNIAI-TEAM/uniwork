import { z } from "zod";
import { PrivacyExportSchema, type PrivacyExport } from "../../types/privacy";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";

const ExportResponse = z.object({ export: PrivacyExportSchema });
const ExportsResponse = z.object({ exports: z.array(PrivacyExportSchema) });

const enc = encodeURIComponent;

export async function listPrivacyExports(orgId: string): Promise<PrivacyExport[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/privacy/exports`);
  return parseWithFallback<{ exports: PrivacyExport[] }>(raw, ExportsResponse, { exports: [] }, {
    endpoint: "GET /api/v1/orgs/{org}/privacy/exports",
  }).exports;
}

export async function createPrivacyExport(orgId: string): Promise<PrivacyExport | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/privacy/exports`, { method: "POST" });
  return (
    parseWithFallback<{ export: PrivacyExport } | null>(raw, ExportResponse, null, {
      endpoint: "POST /api/v1/orgs/{org}/privacy/exports",
    })?.export ?? null
  );
}

export async function createPrivacyDeletion(orgId: string, confirmSlug: string): Promise<PrivacyExport | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/privacy/deletion`, {
    method: "POST",
    body: { confirm_slug: confirmSlug },
  });
  return (
    parseWithFallback<{ export: PrivacyExport } | null>(raw, ExportResponse, null, {
      endpoint: "POST /api/v1/orgs/{org}/privacy/deletion",
    })?.export ?? null
  );
}

export async function cancelPrivacyDeletion(orgId: string): Promise<PrivacyExport | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/privacy/deletion/cancel`, { method: "POST" });
  return (
    parseWithFallback<{ export: PrivacyExport } | null>(raw, ExportResponse, null, {
      endpoint: "POST /api/v1/orgs/{org}/privacy/deletion/cancel",
    })?.export ?? null
  );
}

/** Fetch a finished export through the route that re-checks the owner. */
export async function downloadPrivacyExport(orgId: string, exportId: string): Promise<Blob> {
  return requestBlob(`/api/v1/orgs/${enc(orgId)}/privacy/exports/${enc(exportId)}/download`);
}
