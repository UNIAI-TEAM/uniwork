"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
  const chunked = useChunkedDocumentUpload(target);
  const threshold = chunkedUploadThreshold(limits);

  const isChunkedFile = (file: { size: number }): boolean =>
    threshold !== null && file.size > threshold;

  const uploadDroppedFile = async (file: File): Promise<void> => {
    if (isChunkedFile(file)) {
      await chunked.start({ file, filename: file.name });
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
