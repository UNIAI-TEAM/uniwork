import { z } from "zod";
import {
  FileAccessItemSchema,
  type FileAccessMode,
  type FileDisposition,
  type ResolvedFile,
} from "../../types/file";
import { runtimeConfig } from "../../runtime-config";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const ResolveEnvelope = z.object({ items: z.array(z.unknown()) });

const ENDPOINT = "POST /api/v1/workspaces/{workspaceID}/files/resolve";

function unavailable(fileId: string): ResolvedFile {
  return {
    fileId,
    file: null,
    access: null,
    url: null,
    urlExpiresAt: null,
    error: { code: "file_unavailable", message: "" },
  };
}

function narrowAccess(value: string | undefined): FileAccessMode | null {
  switch (value) {
    case "presign":
    case "proxy":
      return value;
    default:
      return null;
  }
}

/** A proxy URL is API-relative; media elements need the API origin in front
 *  of it. A presigned URL is used exactly as signed. */
function absoluteUrl(url: string, access: FileAccessMode | null): string {
  if (access === "proxy" && url.startsWith("/") && !url.startsWith("//")) {
    return `${runtimeConfig().apiUrl}${url}`;
  }
  return url;
}

function toResolved(raw: unknown, fileId: string): ResolvedFile {
  const item = parseWithFallback<z.infer<typeof FileAccessItemSchema> | null>(
    raw,
    FileAccessItemSchema,
    null,
    { endpoint: ENDPOINT },
  );
  if (!item || item.file_id !== fileId) return unavailable(fileId);
  if (item.error) {
    return {
      fileId,
      file: null,
      access: null,
      url: null,
      urlExpiresAt: null,
      error: { code: item.error.code, message: item.error.message ?? "" },
    };
  }
  const url = item.url?.trim() ?? "";
  if (!item.file || !url) return unavailable(fileId);
  const access = narrowAccess(item.access);
  return {
    fileId,
    file: item.file,
    access,
    url: absoluteUrl(url, access),
    urlExpiresAt: item.url_expires_at ?? null,
    error: null,
  };
}

/**
 * Resolve the caller's own staged uploads in a workspace (files a module has
 * not claimed yet). The answer has one entry per requested id, in request
 * order; a malformed entry degrades to `file_unavailable` for that id only.
 */
export async function resolveWorkspaceFiles(
  workspaceId: string,
  fileIds: readonly string[],
  disposition: FileDisposition = "inline",
  signal?: AbortSignal,
): Promise<ResolvedFile[]> {
  if (fileIds.length === 0) return [];
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/files/resolve`, {
    method: "POST",
    body: { file_ids: [...fileIds], disposition },
    signal,
  });
  const { items } = parseWithFallback<{ items: unknown[] }>(raw, ResolveEnvelope, { items: [] }, {
    endpoint: ENDPOINT,
  });
  return fileIds.map((fileId, i) => toResolved(items[i], fileId));
}
