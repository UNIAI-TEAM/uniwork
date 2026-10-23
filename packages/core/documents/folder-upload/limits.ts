import type { DocumentLimits } from "../../api/endpoints/config";
import type { FolderUploadLimits } from "./types";

export interface FolderUploadRunLimits extends FolderUploadLimits {
  /** Concurrent storage PUTs, clamped to [1, 6]. */
  parallel: number;
  /** Files per complete call, clamped to [1, 50]. */
  completeBatch: number;
  /** Files above this need a probe in the plan; absent when storage is local. */
  chunkedThresholdBytes?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Planner limits and runner knobs from GET /config. Null means the server has
 * no folder uploads, so the entry point hides; there is no client fallback.
 */
export function folderUploadLimits(limits: DocumentLimits): FolderUploadRunLimits | null {
  const block = limits.folder_upload;
  if (!block) return null;
  return {
    maxFiles: block.max_files,
    maxFolders: block.max_folders,
    maxTotalBytes: block.max_total_bytes,
    maxDepth: block.max_depth,
    perFileMaxBytes: limits.upload_max_bytes,
    parallel: clamp(block.parallel, 1, 6),
    completeBatch: clamp(block.complete_batch, 1, 50),
    ...(limits.upload_extensions ? { uploadExtensions: limits.upload_extensions } : {}),
    ...(limits.chunked_upload_threshold_bytes !== undefined
      ? { chunkedThresholdBytes: limits.chunked_upload_threshold_bytes }
      : {}),
  };
}
