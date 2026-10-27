import type { DriveFolderRef } from "../api/endpoints/drive-library";

/** Group key of the last bucket: files whose parent folder is unknown. */
const UNKNOWN_FOLDER_GROUP_KEY = "unknown";

const SHORT_ID_LENGTH = 6;

export type DriveFolderGroupKind = "named" | "unnamed" | "unknown";

export interface DriveFolderGroup<T> {
  /** Stable key: the Drive folder id, or `UNKNOWN_FOLDER_GROUP_KEY`. */
  key: string;
  kind: DriveFolderGroupKind;
  /** Folder name when readable (`named`), otherwise null. */
  name: string | null;
  /** First 6 characters of the folder id (`unnamed` label); null for `unknown`. */
  shortId: string | null;
  files: T[];
}

export function shortDriveFolderId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

function folderName(folder: DriveFolderRef): string | null {
  const name = folder.name?.trim();
  return name ? name : null;
}

/**
 * Splits a list of Drive files into one group per Drive parent folder
 * (UNI-2172 drive-folder contract). Order: named groups A-Z by `locale`, then unnamed groups by
 * short id, then the "folder unknown" group last. Files keep their incoming order inside a group,
 * so whatever sort/filter produced `files` applies unchanged.
 *
 * Returns null when grouping would be pointless — no files, or EVERY file has an unknown
 * parent (an older server, or before the backfill) — and the caller shows the flat list.
 * Pass the already-filtered files: groups with no match never exist and counts are the filtered ones.
 */
export function groupDriveFilesByFolder<T extends { drive_folder?: DriveFolderRef | null }>(
  files: readonly T[],
  locale?: string,
): DriveFolderGroup<T>[] | null {
  const byId = new Map<string, DriveFolderGroup<T>>();
  const unknown: DriveFolderGroup<T> = {
    key: UNKNOWN_FOLDER_GROUP_KEY,
    kind: "unknown",
    name: null,
    shortId: null,
    files: [],
  };
  for (const file of files) {
    const folder = file.drive_folder;
    if (!folder?.id) {
      unknown.files.push(file);
      continue;
    }
    let group = byId.get(folder.id);
    if (!group) {
      const name = folderName(folder);
      group = {
        key: folder.id,
        kind: name ? "named" : "unnamed",
        name,
        shortId: shortDriveFolderId(folder.id),
        files: [],
      };
      byId.set(folder.id, group);
    }
    // The same folder can arrive named on one file and unnamed on another (partial refresh):
    // the name wins so the group is labelled once.
    if (group.kind === "unnamed") {
      const name = folderName(folder);
      if (name) {
        group.kind = "named";
        group.name = name;
      }
    }
    group.files.push(file);
  }
  if (byId.size === 0) return null;

  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const known = [...byId.values()];
  const named = known
    .filter((g) => g.kind === "named")
    .sort((a, b) => collator.compare(a.name ?? "", b.name ?? "") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const unnamed = known
    .filter((g) => g.kind === "unnamed")
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [...named, ...unnamed, ...(unknown.files.length > 0 ? [unknown] : [])];
}
