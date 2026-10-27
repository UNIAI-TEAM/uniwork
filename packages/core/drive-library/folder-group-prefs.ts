import { defaultStorage, sessionStorageAdapter } from "../platform";
import type { StorageAdapter } from "../types/storage";

// Per-viewer "Group by folder" choice of the Drive library (UNI-2172):
// `uniwork_drive_group_by_folder:{userId}` → "1" | "0" through the StorageAdapter.
// Default ON; anything unreadable reads as ON and a failed write keeps the choice for this session only.

const GROUP_BY_FOLDER_KEY = "uniwork_drive_group_by_folder";

function groupByFolderStorageKey(userId: string): string {
  return `${GROUP_BY_FOLDER_KEY}:${userId}`;
}

export function readGroupByFolder(
  userId: string | null | undefined,
  storage: Pick<StorageAdapter, "getItem"> | null | undefined = defaultStorage,
): boolean {
  if (!userId || !storage) return true;
  try {
    return storage.getItem(groupByFolderStorageKey(userId)) !== "0";
  } catch {
    // Blocked storage: default ON.
    return true;
  }
}

export function writeGroupByFolder(
  userId: string | null | undefined,
  on: boolean,
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = defaultStorage,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(groupByFolderStorageKey(userId), on ? "1" : "0");
  } catch {
    // Storage unavailable or blocked: keep the in-memory choice for this session.
  }
}

// Collapsed folder groups are remembered per viewer for the browser session only
// (`sessionStorageAdapter`): `uniwork_drive_collapsed_folders:{userId}` → JSON array of folder-group keys.
const COLLAPSED_KEY = "uniwork_drive_collapsed_folders";

function collapsedFoldersStorageKey(userId: string): string {
  return `${COLLAPSED_KEY}:${userId}`;
}

/** The viewer's collapsed group keys; a broken value reads as "every group open". */
export function readCollapsedFolderGroups(
  userId: string | null | undefined,
  storage: Pick<StorageAdapter, "getItem"> | null | undefined = sessionStorageAdapter,
): string[] {
  if (!userId || !storage) return [];
  try {
    const raw = storage.getItem(collapsedFoldersStorageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function writeCollapsedFolderGroups(
  userId: string | null | undefined,
  keys: readonly string[],
  storage: Pick<StorageAdapter, "setItem"> | null | undefined = sessionStorageAdapter,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(collapsedFoldersStorageKey(userId), JSON.stringify(keys));
  } catch {
    // Storage unavailable or blocked: keep the in-memory choice for this view.
  }
}
