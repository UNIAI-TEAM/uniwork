import type { DriveFolderEntry } from "@uniwork/core/drive-library/folders";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** A folder's visible label: its name, or "Drive folder · <6 chars of the id>" while it is unnamed. */
export function driveFolderLabel(folder: DriveFolderEntry, t: Translate): string {
  return folder.name ?? t("driveLibrary.folder.unnamed", { id: folder.shortId });
}
