// Browser readers for a folder upload (UNI-2052): turn what the page got from
// `<input webkitdirectory>` or a drop into `{ path, size, file }` entries for
// `planFolderUpload`. They only touch File APIs, never the network.

import type { FolderUploadEntry } from "./types";

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

async function walk(entry: FileSystemEntry, prefix: string, out: FolderUploadEntry<File>[]): Promise<void> {
  const path = `${prefix}${entry.name}`;
  if (entry.isFile) {
    const file = await readFile(entry as FileSystemFileEntry);
    out.push({ path, size: file.size, file });
    return;
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walk(child, `${path}/`, out);
  }
}

/**
 * Walks every folder in a drop. Returns one entry list per dropped top folder
 * (an empty folder gives an empty list) and the loose files dropped beside them.
 *
 * Call it synchronously from the `onDrop` handler: the browser empties the
 * `DataTransferItemList` once the event's tick ends, so this function captures
 * every item's entry and file before its first `await`. A file that cannot be
 * read rejects the whole call; nothing is uploaded from a half-read folder.
 */
export async function readDroppedFolders(
  items: DataTransferItemList | DataTransferItem[],
): Promise<{ folders: FolderUploadEntry<File>[][]; looseFiles: File[] }> {
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
  const folders = await Promise.all(
    roots.map(async (root) => {
      const out: FolderUploadEntry<File>[] = [];
      await walk(root, "", out);
      return out;
    }),
  );
  return { folders, looseFiles };
}
