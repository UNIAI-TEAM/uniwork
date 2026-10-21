import type { useTranslation } from "react-i18next";
import { toast } from "sonner";

type TFunction = ReturnType<typeof useTranslation>["t"];

export interface FolderUploadSettled {
  /** The folder's real title, as the server answered (after any "(n)"). */
  title: string;
  total: number;
  done: number;
  failed: number;
  canceled: boolean;
  onOpenFolder: () => void;
  onViewFailures: () => void;
}

export interface FolderUploadToast {
  progress: (counts: { done: number; total: number }) => void;
  settle: (result: FolderUploadSettled) => void;
  dismiss: () => void;
}

/**
 * ONE sonner toast for a whole run (UNI-2052): it is created as the progress
 * line with "Hủy tất cả", then the same id turns into the end state. Never one
 * toast per file.
 */
export function createFolderUploadToast({
  t,
  name,
  total,
  onCancelAll,
}: {
  t: TFunction;
  name: string;
  total: number;
  onCancelAll: () => void;
}): FolderUploadToast {
  const id = `folder-upload-${Math.random().toString(36).slice(2)}`;
  const progress = ({ done, total }: { done: number; total: number }) => {
    toast.loading(t("documents.folder_upload.toast.progress", { name, done, total }), {
      id,
      duration: Number.POSITIVE_INFINITY,
      action: { label: t("documents.folder_upload.toast.cancel_all"), onClick: onCancelAll },
    });
  };
  progress({ done: 0, total });
  return {
    progress,
    dismiss: () => {
      toast.dismiss(id);
    },
    settle: ({ title, total, done, failed, canceled, onOpenFolder, onViewFailures }) => {
      if (canceled) {
        toast.info(t("documents.folder_upload.toast.canceled", { count: done }), { id, duration: 6000, action: undefined });
        return;
      }
      if (failed > 0) {
        toast.warning(t("documents.folder_upload.toast.partial", { done, total, failed }), {
          id,
          duration: Number.POSITIVE_INFINITY,
          action: { label: t("documents.folder_upload.toast.view_failures"), onClick: onViewFailures },
        });
        return;
      }
      toast.success(t("documents.folder_upload.toast.success", { count: done, name: title }), {
        id,
        duration: 10000,
        action: { label: t("documents.folder_upload.toast.open_folder"), onClick: onOpenFolder },
      });
    },
  };
}
