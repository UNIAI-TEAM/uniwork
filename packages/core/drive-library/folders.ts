import type { DriveFolderGroup, DriveFolderRef } from "../api/endpoints/drive-library";

const SHORT_ID_LENGTH = 6;

/** One Drive parent folder seen in a set of files (the Drive library folder tree). */
export interface DriveFolderEntry {
  /** Google Drive folder id: opaque, the tree node key and the URL value. */
  id: string;
  /** Folder name when readable, otherwise null (the label then falls back to the short id). */
  name: string | null;
  /** First 6 characters of the id, for the unnamed label. */
  shortId: string;
  fileCount: number;
}

export interface DriveFolderDerivation<T> {
  /** Named A-Z (numeric collator), then unnamed by id. */
  folders: DriveFolderEntry[];
  /** Files whose parent folder is unknown (null or absent `drive_folder`), in incoming order. */
  unfiled: T[];
}

export function shortDriveFolderId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

function folderName(folder: DriveFolderRef): string | null {
  const name = folder.name?.trim();
  return name ? name : null;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Derives the folders of ONE account from its Drive files (drive-folder contract v2): one entry per
 * `drive_folder.id` with its file count, plus the files that have no known folder. Pass the files
 * of a single account; the order of `files` is kept for `unfiled`.
 *
 * The same folder can arrive named on one file and unnamed on another (partial refresh): the name
 * wins so the folder is labelled once. An older server that sends no `drive_folder` anywhere
 * yields no folders and every file unfiled, which the screens show as today's flat list.
 */
export function deriveDriveFolders<T extends { drive_folder?: DriveFolderRef | null }>(
  files: readonly T[],
  locale?: string,
): DriveFolderDerivation<T> {
  const byId = new Map<string, DriveFolderEntry>();
  const unfiled: T[] = [];
  for (const file of files) {
    const folder = file.drive_folder;
    if (!folder?.id) {
      unfiled.push(file);
      continue;
    }
    const name = folderName(folder);
    const entry = byId.get(folder.id);
    if (entry) {
      entry.fileCount += 1;
      entry.name ??= name;
    } else {
      byId.set(folder.id, { id: folder.id, name, shortId: shortDriveFolderId(folder.id), fileCount: 1 });
    }
  }
  return { folders: sortDriveFolders(byId.values(), locale), unfiled };
}

/** Named A-Z (numeric collator, id tie-break), then unnamed by id: the one order both sources share. */
function sortDriveFolders(entries: Iterable<DriveFolderEntry>, locale?: string): DriveFolderEntry[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const all = [...entries];
  const named = all
    .filter((f) => f.name !== null)
    .sort((a, b) => collator.compare(a.name ?? "", b.name ?? "") || compareIds(a.id, b.id));
  const unnamed = all.filter((f) => f.name === null).sort((a, b) => compareIds(a.id, b.id));
  return [...named, ...unnamed];
}

/**
 * Folder entries from the server's folder list (drive-folder contract v3). The group without a
 * parent (`id` null) is not a folder, so it is dropped; the server's own order is replaced by the
 * client rule so both sources list folders the same way.
 */
export function driveFoldersFromGroups(groups: readonly DriveFolderGroup[], locale?: string): DriveFolderEntry[] {
  const byId = new Map<string, DriveFolderEntry>();
  for (const group of groups) {
    if (!group.id) continue;
    const name = group.name?.trim() || null;
    const entry = byId.get(group.id);
    if (entry) {
      entry.fileCount += group.file_count;
      entry.name ??= name;
    } else {
      byId.set(group.id, { id: group.id, name, shortId: shortDriveFolderId(group.id), fileCount: group.file_count });
    }
  }
  return sortDriveFolders(byId.values(), locale);
}

/** The files that sit directly in one folder, in incoming order. */
export function driveFilesInFolder<T extends { drive_folder?: DriveFolderRef | null }>(
  files: readonly T[],
  folderId: string,
): T[] {
  return files.filter((file) => file.drive_folder?.id === folderId);
}
