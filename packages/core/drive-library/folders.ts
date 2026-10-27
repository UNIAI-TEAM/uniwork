import type { DriveFolderGroup } from "../api/endpoints/drive-library";

const SHORT_ID_LENGTH = 6;

/** One Drive parent folder of an account (the Drive library folder tree). */
export interface DriveFolderEntry {
  /** Google Drive folder id: opaque, the tree node key and the URL value. */
  id: string;
  /** Folder name when readable, otherwise null (the label then falls back to the short id). */
  name: string | null;
  /** First 6 characters of the id, for the unnamed label. */
  shortId: string;
  fileCount: number;
}

export function shortDriveFolderId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Named A-Z (numeric collator, id tie-break), then unnamed by id: the order of the folder tree and of the folder rows. */
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
 * client rule (named A-Z, then unnamed by id) so every screen lists folders the same way.
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
