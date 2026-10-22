// Browser readers for a folder upload (UNI-2052): turn what the page got from
// `<input webkitdirectory>` or a drop into `{ path, size, file }` entries for
// `planFolderUpload`. They only touch File APIs, never the network.

import { isHiddenName, isUploadableName } from "./plan";
import type { FolderUploadEntry } from "./types";

/** `max_files` when the caller does not pass it (GET /config's default). */
const DEFAULT_MAX_FILES = 500;
/** A drop stops being read past `max_files` times this many uploadable files: the planner refuses it anyway. */
const READ_BOUND_FACTOR = 4;

/** Entries of a `webkitdirectory` input; `webkitRelativePath` starts with the picked folder's name. */
export function entriesFromInputFiles(files: ArrayLike<File>): FolderUploadEntry<File>[] {
  const out: FolderUploadEntry<File>[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i] as File;
    out.push({ path: file.webkitRelativePath || file.name, size: file.size, file });
  }
  return out;
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/**
 * One `readEntries()` call returns a partial batch (Chrome caps it at 100), so
 * keep asking until a call comes back empty.
 */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readBatch(reader);
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

interface WalkState {
  out: FolderUploadEntry<File>[];
  /** Files read so far that the planner would upload; only these count toward the bound. */
  uploadable: number;
  bound: number;
  uploadExtensions?: readonly string[];
}

/**
 * Depth-first read. Hidden directories (`.git`, `__MACOSX`, …) are never
 * opened, and the walk stops once more than `bound` files the planner would
 * upload were read (skipped files are listed but not counted).
 * Returns false when it stopped early.
 */
async function walk(entry: FileSystemEntry, prefix: string, state: WalkState): Promise<boolean> {
  const path = `${prefix}${entry.name}`;
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    state.out.push({ path, size: file.size, file });
    if (isUploadableName(entry.name, state.uploadExtensions)) state.uploadable += 1;
    return state.uploadable <= state.bound;
  }
  if (entry.isDirectory) {
    if (prefix !== "" && isHiddenName(entry.name)) return true;
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
      if (!(await walk(child, `${path}/`, state))) return false;
    }
  }
  return true;
}

interface ReadDroppedFoldersOptions {
  /** `max_files` of the folder-upload limits; the walk stops past 4x this many uploadable files. */
  maxFiles?: number;
  /** The server's extension allow-list (as given to the planner); absent = the client's own list. */
  uploadExtensions?: readonly string[];
}

/**
 * Walks every folder in a drop. Returns one entry list per dropped top folder
 * (an empty folder gives an empty list) and the loose files dropped beside them.
 * Hidden directories inside a folder are not read. A folder with more than
 * `maxFiles * 4` files the planner would upload (not hidden, extension
 * allowed; other files are listed but do not count) stops at that bound plus
 * one and is flagged in `truncated`: the uploadable part of its list is then
 * more than `maxFiles`, so the planner refuses it with too_many_files, whose
 * `actual` is a lower bound ("over N"). A folder that is not flagged is listed whole.
 *
 * Call it synchronously from the `onDrop` handler: the browser empties the
 * `DataTransferItemList` once the event's tick ends, so this function captures
 * every item's entry and file before its first `await`. A file that cannot be
 * read rejects the whole call; nothing is uploaded from a half-read folder.
 */
export async function readDroppedFolders(
  items: DataTransferItemList | DataTransferItem[],
  opts: ReadDroppedFoldersOptions = {},
): Promise<{ folders: FolderUploadEntry<File>[][]; looseFiles: File[]; truncated: boolean[] }> {
  const bound = Math.max(1, opts.maxFiles ?? DEFAULT_MAX_FILES) * READ_BOUND_FACTOR;
  const roots: FileSystemEntry[] = [];
  const looseFiles: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as DataTransferItem;
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory) {
      roots.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) looseFiles.push(file);
  }
  const read = await Promise.all(
    roots.map(async (root) => {
      const state: WalkState = { out: [], uploadable: 0, bound, uploadExtensions: opts.uploadExtensions };
      const complete = await walk(root, "", state);
      return { out: state.out, truncated: !complete };
    }),
  );
  return { folders: read.map((r) => r.out), looseFiles, truncated: read.map((r) => r.truncated) };
}
