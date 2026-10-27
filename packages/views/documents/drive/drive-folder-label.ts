import type { DriveFolderEntry } from "@uniwork/core/drive-library/folders";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** A folder's visible label: its name, or "Drive folder · <6 chars of the id>" while it is unnamed. */
export function driveFolderLabel(folder: DriveFolderEntry, t: Translate): string {
  return folder.name ?? t("driveLibrary.folder.unnamed", { id: folder.shortId });
}

/** The sidebar tree's label: a named folder keeps its name, an unnamed one drops to "Folder · <6 chars>" so the short id fits the row. */
export function driveFolderShortLabel(folder: DriveFolderEntry, t: Translate): string {
  return folder.name ?? t("driveLibrary.folder.unnamed_short", { id: folder.shortId });
}
