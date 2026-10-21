// Pure planner for a folder upload (UNI-2052 contract §2). No DOM and no
// transport: the web readers and the desktop app both feed it `{ path, size }`
// pairs, and nothing is sent anywhere until the plan has no refusal.

import { DOCUMENT_TITLE_MAX, FOLDER_TITLE_MAX } from "../folder-limits";
import { validateDocumentUploadFile } from "../limits";
import type {
  FolderUploadEntry,
  FolderUploadLimits,
  FolderUploadPlan,
  FolderUploadSkipReason,
  PlannedFile,
} from "./types";

export interface PlanFolderUploadOptions {
  limits: FolderUploadLimits;
  /** Level of the target folder: workspace root is 0, My Folder is 1. */
  parentLevel: number;
  /** Names of the items already at the target level, for the "(n)" preview. */
  siblingNames: readonly string[];
}

// Matched case-insensitively on the whole segment.
const HIDDEN_NAMES = new Set(["__macosx", "thumbs.db", "ehthumbs.db", "desktop.ini"]);
// Finder's folder icon file: the carriage return is part of its real name, so
// it is matched on the segment as read, before trimming.
const FINDER_ICON = "icon\r";

function nameKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

function isHiddenSegment(raw: string, trimmed: string): boolean {
  return (
    trimmed.startsWith(".") ||
    trimmed.startsWith("~$") ||
    HIDDEN_NAMES.has(trimmed.toLowerCase()) ||
    raw.toLowerCase() === FINDER_ICON
  );
}

/**
 * Smallest free "Name (n)" against the sibling names, compared without case
 * after NFC + trim. This is a preview only: the server decides under its lock
 * and returns the real title.
 */
export function uniqueRootName(name: string, siblingNames: readonly string[]): string {
  const base = name.normalize("NFC").trim();
  const taken = new Set(siblingNames.map(nameKey));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

interface Normalised {
  index: number;
  size: number;
  segments: string[];
}

function normalise(entry: FolderUploadEntry, index: number): Normalised | null {
  const rawSegments = entry.path.split("/");
  const segments: string[] = [];
  for (const raw of rawSegments) {
    const trimmed = raw.normalize("NFC").trim();
    if (trimmed === "" || trimmed === "." || trimmed === "..") return null;
    segments.push(trimmed);
  }
  // A path needs a root folder and a file name.
  if (segments.length < 2) return null;
  return { index, size: entry.size, segments };
}

/** Parent paths of a file, outermost first, ending with its own folder. */
function ancestors(segments: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join("/"));
  return out;
}

function compareFolders(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  return depth !== 0 ? depth : a.localeCompare(b, "vi");
}

export function planFolderUpload(
  entries: readonly FolderUploadEntry[],
  { limits, parentLevel, siblingNames }: PlanFolderUploadOptions,
): FolderUploadPlan {
  const skipped: { path: string; reason: FolderUploadSkipReason }[] = [];
  const kept: Normalised[] = [];
  const roots: string[] = [];
  let firstRoot = "";

  entries.forEach((entry, index) => {
    const n = normalise(entry, index);
    if (!n) {
      skipped.push({ path: entry.path, reason: "invalid_path" });
      return;
    }
    const path = n.segments.join("/");
    if (firstRoot === "") firstRoot = n.segments[0] as string;
    const rawSegments = entry.path.split("/");
    if (n.segments.some((s, i) => isHiddenSegment(rawSegments[i] ?? s, s))) {
      skipped.push({ path, reason: "hidden" });
      return;
    }
    const root = n.segments[0] as string;
    if (!roots.includes(root)) roots.push(root);
    const filename = n.segments[n.segments.length - 1] as string;
    if (filename.length > DOCUMENT_TITLE_MAX) {
      skipped.push({ path, reason: "name_too_long" });
      return;
    }
    const check = validateDocumentUploadFile({ name: filename, size: n.size }, limits.perFileMaxBytes);
    if (!check.ok) {
      skipped.push({ path, reason: check.reason });
      return;
    }
    kept.push(n);
  });

  const rootName = roots[0] ?? firstRoot;
  const plan: FolderUploadPlan = {
    rootName,
    rootTitle: rootName === "" ? "" : uniqueRootName(rootName, siblingNames),
    folders: [],
    files: [],
    skipped,
    totals: { files: 0, bytes: 0 },
    refusal: null,
  };

  if (roots.length > 1) {
    plan.refusal = { code: "multiple_roots", limit: 1, actual: roots.length };
    return plan;
  }

  const folderSet = new Set<string>();
  for (const n of kept) for (const folder of ancestors(n.segments)) folderSet.add(folder);
  const folders = [...folderSet].sort(compareFolders);
  const files: PlannedFile[] = kept.map((n) => ({
    path: n.segments.join("/"),
    filename: n.segments[n.segments.length - 1] as string,
    folderPath: n.segments.slice(0, -1).join("/"),
    size: n.size,
    index: n.index,
  }));
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  plan.folders = folders;
  plan.files = files;
  plan.totals = { files: files.length, bytes };

  const longest = folders.reduce((max, f) => Math.max(max, f.split("/").pop()?.length ?? 0), 0);
  const deepest = kept.reduce((max, n) => Math.max(max, parentLevel + n.segments.length), 0);
  if (longest > FOLDER_TITLE_MAX) {
    plan.refusal = { code: "segment_too_long", limit: FOLDER_TITLE_MAX, actual: longest };
  } else if (files.length === 0) {
    plan.refusal = { code: "nothing_to_upload" };
  } else if (deepest > limits.maxDepth) {
    plan.refusal = { code: "too_deep", limit: limits.maxDepth, actual: deepest };
  } else if (files.length > limits.maxFiles) {
    plan.refusal = { code: "too_many_files", limit: limits.maxFiles, actual: files.length };
  } else if (bytes > limits.maxTotalBytes) {
    plan.refusal = { code: "too_large_total", limit: limits.maxTotalBytes, actual: bytes };
  }
  return plan;
}
