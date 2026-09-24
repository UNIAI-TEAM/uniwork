"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useFileUpload, type UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import { useTranslation } from "react-i18next";

/**
 * `useFileUpload` wired to the failure toast the upload gate depends on.
 * Pass `uploadFile` when Task 5 HTTP is ready; until then hosts can use
 * ContentEditor's `onUploadFile` prop instead.
 */
export function useEditorUpload(uploadFile?: UploadFileFn) {
  const { t } = useTranslation();
  const onError = useCallback(
    (error: Error, file: File) => {
      toast.error(
        t("editor.upload.failed", { filename: file.name, reason: error.message }),
      );
    },
    [t],
  );
  return useFileUpload(uploadFile, onError);
}
