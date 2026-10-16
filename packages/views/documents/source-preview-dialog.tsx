"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/** The mutation `useDownloadDocumentSource` returns; named structurally so callers are not bound to the hook's type. */
export interface SourcePreviewDownloader {
  mutateAsync: (input: { sourceId: string }) => Promise<Blob>;
}

/**
 * The view-only preview of a file from another module (U-SRC1): `open` fetches
 * the download blob and shows it on an object URL inside `dialog`. The URL
 * lives exactly as long as the dialog — revoked on close, on a new open and on
 * unmount — and a blob that resolves after the dialog closed is dropped, never
 * shown or leaked. A download or draw failure toasts `row.preview_failed`.
 */
export function useSourcePreview(download: SourcePreviewDownloader): {
  open: (sourceId: string, name: string) => void;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ name: string; url: string | null } | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    const url = preview?.url ?? null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  const close = () => {
    previewSeq.current += 1;
    setPreview(null);
  };

  const open = (sourceId: string, name: string) => {
    const seq = ++previewSeq.current;
    setPreview({ name, url: null });
    void download.mutateAsync({ sourceId }).then(
      (blob) => {
        if (previewSeq.current === seq) setPreview({ name, url: URL.createObjectURL(blob) });
      },
      (error: unknown) => {
        if (previewSeq.current === seq) {
          setPreview(null);
          toast.error(apiErrorMessage(error) ?? t("documents.home.row.preview_failed"));
        }
      },
    );
  };

  const dialog = (
    <Dialog
      open={preview !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        closeLabel={t("documents.home.row.preview_close")}
        overlayClassName="bg-black/70"
        className="max-w-[calc(100%-2rem)] bg-surface p-3 sm:max-w-4xl"
      >
        <DialogTitle className="sr-only">{preview?.name ?? ""}</DialogTitle>
        {preview?.url ? (
          <img
            src={preview.url}
            alt={preview.name}
            className="mx-auto max-h-[80vh] w-full object-contain"
            onError={() => {
              // A mime the allowlist passed can still fail to draw: close and say so.
              close();
              toast.error(t("documents.home.row.preview_failed"));
            }}
          />
        ) : (
          <div role="status" className="flex h-64 items-center justify-center">
            <span className="sr-only">{t("documents.home.row.preview_loading")}</span>
            <Spinner />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return { open, dialog };
}
