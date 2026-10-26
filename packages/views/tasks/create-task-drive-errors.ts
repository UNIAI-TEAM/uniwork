import { errorCode, errorFields } from "@uniwork/core/api";
import type { CreateTaskDraftDriveFile } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { driveLinkErrorReason } from "../integrations/drive-picker";

function parseFailedDriveFilesIndex(
  fields: Record<string, unknown>,
): number | undefined {
  const raw = fields.drive_files_index;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return undefined;
}

export interface CreateTaskDriveErrorResolution {
  updatedDriveFiles: CreateTaskDraftDriveFile[];
  toastMessage: string;
}

/**
 * Resolves a per-file Google Drive error returned from `POST /api/v1/workspaces/{ws}/tasks`
 * against the draft's `driveFiles` array (contract W4 gaps §1: `error.fields.drive_files_index`
 * 0-based integer + `error.fields.external_file_id` string). Stores only `errorCode` in the
 * persisted draft and derives localized toast copy at render / error time.
 */
export function resolveCreateTaskDriveError(
  error: unknown,
  currentFiles: CreateTaskDraftDriveFile[] | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): CreateTaskDriveErrorResolution | null {
  if (!currentFiles?.length) return null;

  const code = errorCode(error);
  const fields = errorFields(error) ?? {};
  const failedIndex = parseFailedDriveFilesIndex(fields);
  if (failedIndex === undefined) {
    return null;
  }

  const failedExternalFileId =
    typeof fields.external_file_id === "string"
      ? fields.external_file_id
      : undefined;

  const resolvedErrorCode = code ?? "link_failed";
  const reason = driveLinkErrorReason(resolvedErrorCode, (k) =>
    t(`drive.picker.${k}`),
  );
  let matchedName: string | undefined;

  const updatedDriveFiles: CreateTaskDraftDriveFile[] = currentFiles.map(
    (df, index) => {
      const matchesFile =
        index === failedIndex &&
        (!failedExternalFileId || df.externalFileId === failedExternalFileId);
      if (matchesFile) {
        matchedName = df.name;
        return {
          ...df,
          errorCode: resolvedErrorCode,
        };
      }
      return df;
    },
  );

  if (!matchedName) {
    return null;
  }

  return {
    updatedDriveFiles,
    toastMessage: t("drive.picker.errors.file_error_named", {
      name: matchedName,
      reason,
    }),
  };
}
