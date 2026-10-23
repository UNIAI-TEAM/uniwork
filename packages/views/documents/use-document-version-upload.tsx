"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { getDocumentEditLock } from "@uniwork/core/api/endpoints/documents-edit-lock";
import { ChunkedUploadError, chunkedUploadThreshold } from "@uniwork/core/documents/chunked-upload";
import { heldEditLockId } from "@uniwork/core/documents/edit-lock-registry";
import {
  useChunkedDocumentUpload,
  useDocumentLimits,
  useUploadDocumentFile,
} from "@uniwork/core/documents/hooks";
import { useCommitDocumentVersion } from "@uniwork/core/documents/hooks-versions";
import { documentKeys } from "@uniwork/core/documents/keys";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import { createSafeId } from "@uniwork/core/utils";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { reportWriteRefused } from "./edit-lock-refusal";

export interface DocumentVersionUploadOptions {
  wsId: string;
  documentId: string;
  /** The revision the commit must beat (the document's, or a chat card's). */
  revision: string;
  /** The chat room the card sits in: the server writes the document_version line there (contract §4.4). */
  chatRoomId?: string;
  /** The version the document carries now: identical bytes answer it back, and that no-op gets the quiet "no change" note. */
  versionIdBefore?: string;
  /** The caller's own sentence for a failure; null keeps the documents copy. */
  describeError?: (err: unknown) => string | null;
  /** A way out rendered under the error sentence for this failure, or null. */
  errorAction?: (err: unknown) => ReactNode;
  /** The host's dressing for the dialog (the chat card's UniChat look). */
  dialogClassName?: string;
  onCommitted?: () => void;
  onFailed?: (err: unknown) => void;
}

export interface DocumentVersionUpload {
  open: () => void;
  /** The new-version dialog; render it once wherever the trigger lives, outside any menu. */
  dialog: ReactNode;
  pending: boolean;
}

/**
 * Stage a new version of a file document and commit it (POST uploads or a
 * chunked session, then POST versions/commit, C-01 §14.4). One writer for
 * every surface — the document page and the chat card — so each one honours
 * the edit lock (UNI-1645): the commit names the lock this tab holds, a
 * chunked upload checks the lock before it sends a byte, and a 423 tells the
 * page that owns the hold. One Idempotency-Key per user intent: a retry of
 * the same pick replays the same write, a different pick or a different lock
 * mints a new one.
 */
export function useDocumentVersionUpload({
  wsId,
  documentId,
  revision,
  chatRoomId,
  versionIdBefore,
  describeError,
  errorAction,
  dialogClassName,
  onCommitted,
  onFailed,
}: DocumentVersionUploadOptions): DocumentVersionUpload {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const upload = useUploadDocumentFile(wsId, documentId);
  const commit = useCommitDocumentVersion(wsId, documentId);
  const chunkedTarget = useMemo(() => ({ kind: "version" as const, documentId }), [documentId]);
  const chunked = useChunkedDocumentUpload(chunkedTarget);
  const [dialogOpen, setDialogOpen] = useState(false);
  const limits = useDocumentLimits({ enabled: dialogOpen });
  const threshold = chunkedUploadThreshold(limits);
  const [failure, setFailure] = useState<{ message: string; cause: unknown } | null>(null);
  const mountedRef = useRef(true);
  const idempotencyKey = useRef<string | null>(null);
  // The commit body carries edit_lock_id, so a key is only valid for the lock id it was minted under.
  const keyLockId = useRef<string | undefined>(undefined);
  const pending = upload.isPending || commit.isPending;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isChunkedFile = (file: { size: number }): boolean => threshold !== null && file.size > threshold;

  const stageNewVersion = async (picked: File) => {
    const invalid = documentUploadValidationMessage(picked, limits.upload_max_bytes, t, i18n.language);
    if (invalid) {
      setFailure({ message: invalid, cause: null });
      return;
    }
    setFailure(null);
    const lockId = heldEditLockId(documentId);
    if (idempotencyKey.current && keyLockId.current !== lockId) idempotencyKey.current = null;
    if (!idempotencyKey.current) keyLockId.current = lockId;
    idempotencyKey.current ??= createSafeId();
    const useChunked = isChunkedFile(picked);
    let staged = false;
    try {
      let uploadId: string;
      if (useChunked) {
        const lockState = await queryClient
          .fetchQuery({
            queryKey: documentKeys.editLock(wsId, documentId),
            queryFn: ({ signal }) => getDocumentEditLock(documentId, signal),
            staleTime: 0,
          })
          .catch(() => null);
        const lock = lockState?.lock;
        if (lock && (!lock.held_by_me || !heldEditLockId(documentId))) {
          // Same shape as a server 423 body: never the lock id, which a
          // manage-level reader of the summary may see.
          const fields: Record<string, unknown> = {};
          for (const key of ["holder_id", "holder_name", "since", "expires_at", "held_by_me", "offline_hold_until"] as const) {
            if (lock[key] != null) fields[key] = lock[key];
          }
          throw new ApiError("", "document_locked", 423, undefined, fields);
        }
        const res = await chunked.start({
          file: picked,
          filename: picked.name,
          idempotencyKey: idempotencyKey.current,
        });
        if (res.kind !== "upload") {
          throw new Error("Expected upload result from version upload session");
        }
        uploadId = res.upload.upload_id;
      } else {
        const upload0 = await upload.mutateAsync({
          file: picked,
          idempotencyKey: idempotencyKey.current,
        });
        uploadId = upload0.upload_id;
      }
      // The user left: the finished upload is deliberately NOT committed as a
      // version (R2-5). Nothing tells them, and nothing should — they are gone,
      // and the next attempt resumes or re-uploads.
      if (!mountedRef.current) return;
      staged = true;
      const committed = await commit.mutateAsync({
        upload_id: uploadId,
        base_revision: revision,
        // The mounted Office editor holds the lock; a new version replaces content (UNI-1645).
        ...(lockId ? { edit_lock_id: lockId } : {}),
        ...(chatRoomId ? { chat_room_id: chatRoomId } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = null;
      if (mountedRef.current) {
        setDialogOpen(false);
        // Identical bytes answer 200 with the version the document already
        // carries (UNI-1900): say so instead of staying silent (D-2).
        if (versionIdBefore && committed.version.id === versionIdBefore) {
          toast.message(t("documents.upload.no_change"));
        }
      }
      onCommitted?.();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ChunkedUploadError && err.code === "upload_canceled") {
        return;
      }
      if (err instanceof ApiError && (err.code === "document_locked" || err.status === 423)) {
        // The page ends its hold when this was the lock it holds; a new lock id is a new write.
        reportWriteRefused(documentId, err.fields, lockId);
        idempotencyKey.current = null;
      }
      // A stale revision: the retry commits on a newer base, a different
      // payload, so it must not replay this attempt's key.
      if (err instanceof ApiError && err.code === "document_version_conflict") idempotencyKey.current = null;
      const message =
        describeError?.(err) ??
        documentErrorMessage(err, t, staged ? "documents.file.commit_failed" : "documents.file.upload_failed", {
          locale: i18n.language,
          file: picked,
          maxBytes: limits.upload_max_bytes,
          resumable: !staged && useChunked && chunked.hasResumable(picked),
        });
      setFailure({ message, cause: err });
      onFailed?.(err);
    }
  };

  const dialog = (
    <DocumentUploadDialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) {
          idempotencyKey.current = null;
          setFailure(null);
          chunked.reset();
        }
        setDialogOpen(next);
      }}
      title={t("documents.upload.version_title")}
      description={t("documents.upload.version_description")}
      hint={t("documents.upload.size_hint", { max: formatDocumentSizeMB(limits.upload_max_bytes, i18n.language) })}
      pending={pending}
      error={failure?.message ?? null}
      errorAction={failure && errorAction ? errorAction(failure.cause) : null}
      showShareToggle={false}
      className={dialogClassName}
      onSubmit={(picked) => void stageNewVersion(picked)}
      chunkedProgress={chunked.progress}
      onPause={chunked.pause}
      onResume={chunked.resume}
      onCancelUpload={(file) => {
        idempotencyKey.current = null;
        setFailure(null);
        void chunked.cancel(file ?? undefined);
      }}
      hasResumable={(file) => isChunkedFile(file) && chunked.hasResumable(file)}
      onPickFile={() => {
        // A different pick is a new intent: the key from a failed upload
        // must not be replayed against different bytes (RFC-08).
        idempotencyKey.current = null;
        setFailure(null);
      }}
    />
  );

  return { open: () => setDialogOpen(true), dialog, pending };
}
