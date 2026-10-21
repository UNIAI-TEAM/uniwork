// Browser readers for a folder upload (UNI-2052): turn what the page got from
// `<input webkitdirectory>` or a drop into `{ path, size, file }` entries for
// `planFolderUpload`. They only touch File APIs, never the network.

import { isHiddenName } from "./plan";
import type { FolderUploadEntry } from "./types";

/** `max_files` when the caller does not pass it (GET /config's default). */
const DEFAULT_MAX_FILES = 500;
/** A drop stops being read past `max_files` times this: the planner refuses it anyway. */
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

/**
 * Depth-first read. Hidden directories (`.git`, `__MACOSX`, …) are never
 * opened, and the walk stops once `out` holds more than `bound` files.
 * Returns false when it stopped early.
 */
async function walk(entry: FileSystemEntry, prefix: string, out: FolderUploadEntry<File>[], bound: number): Promise<boolean> {
  const path = `${prefix}${entry.name}`;
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    out.push({ path, size: file.size, file });
    return out.length <= bound;
  }
  if (entry.isDirectory) {
    if (prefix !== "" && isHiddenName(entry.name)) return true;
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
      if (!(await walk(child, `${path}/`, out, bound))) return false;
    }
  }
  return true;
}

interface ReadDroppedFoldersOptions {
  /** `max_files` of the folder-upload limits; the walk reads at most 4x this plus one per folder. */
  maxFiles?: number;
}

/**
 * Walks every folder in a drop. Returns one entry list per dropped top folder
 * (an empty folder gives an empty list) and the loose files dropped beside them.
 * Hidden directories inside a folder are not read. A folder with more than
 * `maxFiles * 4` files stops at that bound plus one and is flagged in
 * `truncated`: its list is still enough for the planner to refuse it with
 * too_many_files, whose `actual` is then a lower bound ("over N").
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
      const out: FolderUploadEntry<File>[] = [];
      const complete = await walk(root, "", out, bound);
      return { out, truncated: !complete };
    }),
  );
  return { folders: read.map((r) => r.out), looseFiles, truncated: read.map((r) => r.truncated) };
}
