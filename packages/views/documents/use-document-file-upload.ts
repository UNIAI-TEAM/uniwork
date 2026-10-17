"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChunkedUploadError,
  chunkedUploadThreshold,
} from "@uniwork/core/documents/chunked-upload";
import {
  useChunkedDocumentUpload,
  useCreateDocumentFile,
  type useDocumentLimits,
} from "@uniwork/core/documents/hooks";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import type { DocumentUploadDialogProps } from "./document-upload-dialog";

type DocumentLimits = ReturnType<typeof useDocumentLimits>;

interface UseDocumentFileUploadOptions {
  wsId: string;
  parentId: string | null;
  limits: DocumentLimits;
  onOpen: (documentId: string) => void;
}

/**
 * Manages the upload dialog and drop-upload flow for `DocumentsPageView`,
 * routing files above `chunkedUploadThreshold(limits)` through
 * `useChunkedDocumentUpload` and smaller files through `useCreateDocumentFile`.
 */
export function useDocumentFileUpload({
  wsId,
  parentId,
  limits,
  onOpen,
}: UseDocumentFileUploadOptions) {
  const { t, i18n } = useTranslation();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // The loading toast of the drop currently in flight. `chunked.start()` never
  // settles once the hook's own cleanup paused the engine, so its `finally`
  // never dismisses the toast (R2-2): the unmount effect below has to.
  const dropToastRef = useRef<{
    id: string | number;
    file: File;
    percent: number;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (dropToastRef.current !== null) {
        toast.dismiss(dropToastRef.current.id);
        dropToastRef.current = null;
      }
    };
  }, []);

  const createFile = useCreateDocumentFile(wsId);
  const target = useMemo(
    () => ({
      kind: "workspace" as const,
      workspaceId: wsId,
      ...(parentId ? { parentId } : {}),
    }),
    [wsId, parentId],
  );
  const chunked = useChunkedDocumentUpload(target, {
    onProgress: (p) => {
      const activeDrop = dropToastRef.current;
      if (!activeDrop || !mountedRef.current) return;
      const percent =
        p.totalBytes > 0 ? Math.min(100, Math.floor((p.sentBytes / p.totalBytes) * 100)) : 0;
      if (percent === activeDrop.percent) return;
      activeDrop.percent = percent;
      toast.loading(
        t("documents.upload.drop_progress", { name: activeDrop.file.name, percent }),
        {
          id: activeDrop.id,
          action: {
            label: t("documents.upload.cancel"),
            onClick: () => void chunked.cancel(activeDrop.file),
          },
        },
      );
    },
  });
  const threshold = chunkedUploadThreshold(limits);

  const isChunkedFile = (file: { size: number }): boolean =>
    threshold !== null && file.size > threshold;

  const uploadDroppedFile = async (file: File): Promise<void> => {
    if (isChunkedFile(file)) {
      const toastId = toast.loading(
        t("documents.upload.drop_progress", { name: file.name, percent: 0 }),
        {
          action: {
            label: t("documents.upload.cancel"),
            onClick: () => void chunked.cancel(file),
          },
        },
      );
      dropToastRef.current = { id: toastId, file, percent: 0 };
      try {
        await chunked.start({ file, filename: file.name });
      } finally {
        if (dropToastRef.current?.id === toastId) dropToastRef.current = null;
        toast.dismiss(toastId);
      }
      return;
    }
    await createFile.mutateAsync({
      file,
      meta: parentId ? { parent_id: parentId } : undefined,
    });
  };

  const uploadFile = async (file: File): Promise<void> => {
    const invalid = documentUploadValidationMessage(
      file,
      limits.upload_max_bytes,
      t,
      i18n.language,
    );
    if (invalid) {
      setUploadError(invalid);
      return;
    }
    setUploadError(null);
    try {
      if (isChunkedFile(file)) {
        const res = await chunked.start({ file, filename: file.name });
        if (!mountedRef.current) return;
        if (res.kind === "document") {
          setUploadOpen(false);
          onOpen(res.document.id);
        }
        return;
      }
      const doc = await createFile.mutateAsync({
        file,
        meta: parentId ? { parent_id: parentId } : undefined,
      });
      if (!mountedRef.current) return;
      setUploadOpen(false);
      onOpen(doc.id);
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ChunkedUploadError && error.code === "upload_canceled") {
        return;
      }
      setUploadError(
        documentErrorMessage(error, t, "documents.page.upload_failed", {
          locale: i18n.language,
          file,
          maxBytes: limits.upload_max_bytes,
          resumable: isChunkedFile(file) && chunked.hasResumable(file),
        }),
      );
    }
  };

  const dialogProps: DocumentUploadDialogProps = {
    open: uploadOpen,
    onOpenChange: (next) => {
      if (!next) {
        setUploadError(null);
        chunked.reset();
      }
      setUploadOpen(next);
    },
    title: t("documents.upload.title"),
    description: t("documents.upload.description"),
    hint: t("documents.upload.size_hint", {
      max: formatDocumentSizeMB(limits.upload_max_bytes, i18n.language),
    }),
    pending: createFile.isPending,
    error: uploadError,
    onSubmit: (file) => void uploadFile(file),
    chunkedProgress: chunked.progress,
    onPause: chunked.pause,
    onResume: chunked.resume,
    onCancelUpload: (file) => {
      setUploadError(null);
      void chunked.cancel(file ?? undefined);
    },
    hasResumable: (file) => isChunkedFile(file) && chunked.hasResumable(file),
    onPickFile: () => setUploadError(null),
  };

  return {
    openUpload: () => setUploadOpen(true),
    uploadDroppedFile,
    dialogProps,
  };
}
