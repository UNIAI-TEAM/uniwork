import type { DocumentLimits, PublicConfig } from "../../api/endpoints/config";

export type AppConfig =
  | PublicConfig
  | DocumentLimits
  | {
      documents?: { limits?: { chunked_upload_threshold_bytes?: number | null } | null } | null;
      chunked_upload_threshold_bytes?: number | null;
    };

/** Bytes above which a document upload must use an upload session; null = never (no multipart backend). */
export function chunkedUploadThreshold(config: AppConfig | null | undefined): number | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  if ("chunked_upload_threshold_bytes" in config) {
    const val = config.chunked_upload_threshold_bytes;
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      return val;
    }
  }
  if ("documents" in config && config.documents?.limits) {
    const val = config.documents.limits.chunked_upload_threshold_bytes;
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      return val;
    }
  }
  return null;
}
