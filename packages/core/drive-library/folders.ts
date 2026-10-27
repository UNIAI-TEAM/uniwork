import type { DriveFolderRef } from "../api/endpoints/drive-library";

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
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const all = [...byId.values()];
  const named = all
    .filter((f) => f.name !== null)
    .sort((a, b) => collator.compare(a.name ?? "", b.name ?? "") || compareIds(a.id, b.id));
  const unnamed = all.filter((f) => f.name === null).sort((a, b) => compareIds(a.id, b.id));
  return { folders: [...named, ...unnamed], unfiled };
}

/** The files that sit directly in one folder, in incoming order. */
export function driveFilesInFolder<T extends { drive_folder?: DriveFolderRef | null }>(
  files: readonly T[],
  folderId: string,
): T[] {
  return files.filter((file) => file.drive_folder?.id === folderId);
}
