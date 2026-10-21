import { createElement } from "react";
import type { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { modeContext, type FolderUploadMode } from "./folder-upload-copy";

type TFunction = ReturnType<typeof useTranslation>["t"];

export interface FolderUploadSettled {
  /** The folder's real title, as the server answered (after any "(n)"). */
  title: string;
  total: number;
  done: number;
  failed: number;
  canceled: boolean;
  /** 410: the batch is gone; the folder has to be uploaded again, so there is nothing to retry. */
  expired?: boolean;
  /** Absent when the destination is the folder already on screen: "Mở thư mục" would open nothing new. */
  onOpenFolder?: () => void;
  onViewFailures: () => void;
  /** The batch was closed with the page gone: no "Xem" (the report lives in the page), and the toast says so. */
  closed?: boolean;
}

export interface FolderUploadToast {
  progress: (counts: { done: number; total: number }) => void;
  settle: (result: FolderUploadSettled) => void;
  /** Turn a settled end state with failures into its closed form (R2-2); anything else stays as it is. */
  close: () => void;
  dismiss: () => void;
}

const CLOSED_TOAST_MS = 10000;

/**
 * ONE sonner toast for a whole run (UNI-2052): it is created as the progress
 * line with "Hủy tất cả", then the same id turns into the end state. Never one
 * toast per file. A retry of the failed files gets its own toast (`retry`), so
 * the first run's settled toast is never turned back into a progress line.
 */
export function createFolderUploadToast({
  t,
  name,
  total,
  done = 0,
  onCancelAll,
  retry = false,
  mode = "folder",
}: {
  t: TFunction;
  name: string;
  total: number;
  /** Files already up when the toast opens (a retry starts from the first run's count). */
  done?: number;
  onCancelAll: () => void;
  retry?: boolean;
  /** Files mode names no folder while it runs (ADDENDUM 2); `name` is still the destination for the end state. */
  mode?: FolderUploadMode;
}): FolderUploadToast {
  const ctx = modeContext(mode);
  const id = `folder-upload-${Math.random().toString(36).slice(2)}`;
  const progressKey = retry ? "documents.folder_upload.retry_toast.progress" : "documents.folder_upload.toast.progress";
  const cancelKey = retry ? "documents.folder_upload.retry_toast.cancel" : "documents.folder_upload.toast.cancel_all";
  const progress = (counts: { done: number; total: number }) => {
    const message = t(progressKey, { name, done: counts.done, total: counts.total, ...ctx });
    toast.loading(message, {
      id,
      duration: Number.POSITIVE_INFINITY,
      action: { label: t(cancelKey), onClick: onCancelAll },
      // A thin bar under the text (F7); the text stays the accessible name of the progress.
      description: createElement(Progress, {
        value: counts.total > 0 ? Math.min(100, Math.round((counts.done / counts.total) * 100)) : 0,
        "aria-label": message,
        className: "mt-1 w-full",
      }),
    });
  };
  progress({ done, total });
  let last: FolderUploadSettled | null = null;
  const settle = (result: FolderUploadSettled) => {
    last = result;
    const { title, total: runTotal, done, failed, canceled, expired, onOpenFolder, onViewFailures, closed = false } = result;
    const viewFailures = failed > 0 && !closed ? { label: t("documents.folder_upload.toast.view_failures"), onClick: onViewFailures } : undefined;
    if (canceled) {
      const message = done > 0 ? t("documents.folder_upload.toast.canceled", { count: done }) : t("documents.folder_upload.toast.canceled_none");
      // `description: undefined` on every end state: sonner merges a same-id update, so the loading bar would survive.
      toast.info(message, { id, duration: 6000, action: undefined, description: undefined });
      return;
    }
    if (expired) {
      toast.warning(t("documents.folder_upload.toast.expired", { name: title, done, total: runTotal, ...ctx }), {
        id,
        // Without "Xem" there is no decision to wait for, so only the actionable form stays.
        duration: closed || failed === 0 ? CLOSED_TOAST_MS : Number.POSITIVE_INFINITY,
        action: viewFailures,
        description: undefined,
      });
      return;
    }
    if (failed > 0) {
      toast.warning(t("documents.folder_upload.toast.partial", { done, total: runTotal, failed }), {
        id,
        // The "Xem" form asks for a decision and stays; the closed form only informs, so it expires.
        duration: closed ? CLOSED_TOAST_MS : Number.POSITIVE_INFINITY,
        action: viewFailures,
        description: closed ? t("documents.folder_upload.toast.closed") : undefined,
      });
      return;
    }
    toast.success(t("documents.folder_upload.toast.success", { count: done, name: title }), {
      id,
      duration: 10000,
      action: onOpenFolder ? { label: t("documents.folder_upload.toast.open_folder"), onClick: onOpenFolder } : undefined,
      description: undefined,
    });
  };
  return {
    progress,
    settle,
    close: () => {
      if (last && last.failed > 0 && !last.canceled && !last.closed) settle({ ...last, closed: true });
    },
    dismiss: () => {
      toast.dismiss(id);
    },
  };
}
