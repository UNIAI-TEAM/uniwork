// Shared shapes of the folder-upload planner and its web readers
// (UNI-2052). `planFolderUpload` is pure so the desktop app can feed it
// `{ path, size }` pairs from its own file dialog; `file` carries the browser
// `File` only on the web side and is never read by the planner.

export interface FolderUploadEntry<F = unknown> {
  /** Relative path with `/` separators; the first segment is the dropped or picked folder. */
  path: string;
  size: number;
  file?: F;
}

export type FolderUploadSkipReason = "hidden" | "unsupported_format" | "too_large" | "name_too_long" | "invalid_path";

export type FolderUploadRefusalCode =
  | "too_many_files"
  | "too_many_folders"
  | "too_large_total"
  | "too_deep"
  | "nothing_to_upload"
  | "segment_too_long"
  | "multiple_roots";

export interface FolderUploadLimits {
  maxFiles: number;
  /** Folders the upload creates, root included; absent = no folder cap. */
  maxFolders?: number;
  maxTotalBytes: number;
  maxDepth: number;
  perFileMaxBytes: number;
  /** Server allow-list (lower case, no dot); absent = the client's own list. */
  uploadExtensions?: readonly string[];
}

export interface PlannedFile {
  /** Normalised relative path, root segment first. */
  path: string;
  filename: string;
  /** Normalised path of the file's parent folder, root included; "" in files mode. */
  folderPath: string;
  size: number;
  /** Position in the input entries, so callers map back to their File objects. */
  index: number;
}

export interface FolderUploadPlan {
  /** Root folder name as found; null in files mode (`planFileUpload`), which has no root. */
  rootName: string | null;
  /** Root folder name after the "(n)" preview; null in files mode. */
  rootTitle: string | null;
  /** Relative folder paths including the root, top-down; [] in files mode. */
  folders: string[];
  files: PlannedFile[];
  skipped: { path: string; reason: FolderUploadSkipReason }[];
  totals: { files: number; bytes: number };
  refusal: null | { code: FolderUploadRefusalCode; limit?: number; actual?: number };
}
