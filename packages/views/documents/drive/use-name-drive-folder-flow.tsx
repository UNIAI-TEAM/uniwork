"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, errorCode } from "@uniwork/core/api";
import { useNameDriveFolder } from "@uniwork/core/drive-library/hooks";
import { useDrivePicker, type DrivePickerAdapter } from "../../integrations/drive-picker";

export interface NameDriveFolderFlow {
  /** Opens the folder Picker for an unnamed folder, then names it from what Google answers. */
  nameFolder: (folderId: string, connectionId: string) => void;
  pending: boolean;
  /** Picker dialogs (account step, reconnect); render once next to the trigger. */
  dialogs: ReactNode;
}

/** The copy key of a failed name request (drive-folder contract v3 item 3). */
function nameErrorKey(err: unknown): string {
  const code = errorCode(err);
  const status = err instanceof ApiError ? err.status : 0;
  if (code === "auth_failed" || code === "drive_connection_lost" || code === "needs_reconnect") {
    return "drive.picker.errors.token_failed";
  }
  if (code === "drive_unavailable" || status === 429 || status === 503) return "driveLibrary.folder.name_unavailable";
  if (code === "drive_folder_not_folder" || status === 422) return "driveLibrary.folder.name_not_folder";
  if (code === "drive_folder_not_found" || status === 404) return "driveLibrary.folder.name_not_found";
  return "driveLibrary.folder.name_failed";
}

/**
 * "Name this folder" for a Drive folder whose name is not known yet (drive-folder contract v3 item 3):
 * the Google Picker, limited to folders, lets the person pick that folder so UniWork may read its
 * name; the picked id has to be the folder asked for, then the server names it from Google and the
 * folder and file lists refetch.
 */
export function useNameDriveFolderFlow(wsId: string, adapter?: DrivePickerAdapter): NameDriveFolderFlow {
  const { t } = useTranslation();
  const naming = useNameDriveFolder(wsId);
  const { mutateAsync } = naming;
  const wantedRef = useRef<string | null>(null);

  const picker = useDrivePicker({
    wsId,
    adapter,
    onPicked: ({ connectionId, pickedFiles }) => {
      const wanted = wantedRef.current;
      wantedRef.current = null;
      if (!wanted) return;
      if (pickedFiles[0]?.id !== wanted) {
        toast.error(t("driveLibrary.folder.name_mismatch"));
        return;
      }
      mutateAsync({ folderId: wanted, connectionId }).then(
        () => toast.success(t("driveLibrary.folder.name_done")),
        (err: unknown) => toast.error(t(nameErrorKey(err))),
      );
    },
  });
  const { open } = picker;

  const nameFolder = useCallback(
    (folderId: string, connectionId: string) => {
      wantedRef.current = folderId;
      open({ connectionId, folder: true });
    },
    [open],
  );

  return { nameFolder, pending: picker.pending || naming.isPending, dialogs: picker.dialogs };
}
