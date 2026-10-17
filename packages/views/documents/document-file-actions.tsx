"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import {
  ChunkedUploadError,
  chunkedUploadThreshold,
} from "@uniwork/core/documents/chunked-upload";
import { heldEditLockId } from "@uniwork/core/documents/edit-lock-registry";
import {
  useChunkedDocumentUpload,
  useDocumentDownload,
  useDocumentLimits,
  useUploadDocumentFile,
} from "@uniwork/core/documents/hooks";
import { useCommitDocumentVersion } from "@uniwork/core/documents/hooks-versions";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
import type { Document } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { reportWriteRefused } from "./edit-lock-refusal";

export interface DocumentFileActions {
  /** Downloads the live bytes, or one version's bytes when given. */
  download: (version?: number) => Promise<void>;
  /** "live", a version ordinal as a string, or null while idle. */
  downloading: string | null;
  openUpload: () => void;
  /** The new-version dialog; render it once wherever the actions live. */
  uploadDialog: ReactNode;
}

/**
 * The two file commands the H1 API supports for `kind=file` — download the
 * bytes and stage a new version (POST uploads + POST versions/commit, C-01
 * §14.4). Shared by the plain file view and by the page overflow menu while
 * the Office editor replaces that view, so both run the same writes.
 */
export function useDocumentFileActions(wsId: string, doc: Document): DocumentFileActions {
  const { t, i18n } = useTranslation();
  const downloadFile = useDocumentDownload(wsId, doc.id);
  const upload = useUploadDocumentFile(wsId, doc.id);
  const commit = useCommitDocumentVersion(wsId, doc.id);
  const chunkedTarget = useMemo(() => ({ kind: "version" as const, documentId: doc.id }), [doc.id]);
  const chunked = useChunkedDocumentUpload(chunkedTarget);
  const [dialogOpen, setDialogOpen] = useState(false);
  const limits = useDocumentLimits({ enabled: dialogOpen });
  const threshold = chunkedUploadThreshold(limits);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // One key per user intent: a retry of the same pick must replay the same
  // write, not mint a second version of one upload.
  const idempotencyKey = useRef<string | null>(null);
  // The commit body carries edit_lock_id, so a key is only valid for the lock id it was minted under.
  const keyLockId = useRef<string | undefined>(undefined);
  const pending = upload.isPending || commit.isPending;

  const isChunkedFile = (file: { size: number }): boolean =>
    threshold !== null && file.size > threshold;

  const download = async (version?: number) => {
    const target = version === undefined ? "live" : String(version);
    setDownloading(target);
    try {
      const blob = await downloadFile.mutateAsync({ version });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = doc.file?.filename ?? doc.title;
      anchor.rel = "noopener";
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error(t("documents.file.download_failed"));
    } finally {
      setDownloading(null);
    }
  };

  const stageNewVersion = async (picked: File) => {
    const invalid = documentUploadValidationMessage(picked, limits.upload_max_bytes, t, i18n.language);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    const lockId = heldEditLockId(doc.id);
    if (idempotencyKey.current && keyLockId.current !== lockId) idempotencyKey.current = null;
    if (!idempotencyKey.current) keyLockId.current = lockId;
    idempotencyKey.current ??= createSafeId();
    const useChunked = isChunkedFile(picked);
    let staged = false;
    try {
      let uploadId: string;
      if (useChunked) {
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
      staged = true;
      await commit.mutateAsync({
        upload_id: uploadId,
        base_revision: doc.revision,
        // The mounted Office editor holds the lock; a new version replaces content (UNI-1645).
        ...(lockId ? { edit_lock_id: lockId } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = null;
      setDialogOpen(false);
    } catch (err) {
      if (err instanceof ChunkedUploadError && err.code === "upload_canceled") {
        return;
      }
      if (err instanceof ApiError && err.code === "document_locked") {
        // The page ends its hold when this was the lock it holds; a new lock id is a new write.
        reportWriteRefused(doc.id, err.fields, lockId);
        idempotencyKey.current = null;
      }
      setError(
        documentErrorMessage(
          err,
          t,
          staged ? "documents.file.commit_failed" : "documents.file.upload_failed",
          {
            locale: i18n.language,
            file: picked,
            maxBytes: limits.upload_max_bytes,
            resumable: !staged && useChunked && chunked.hasResumable(picked),
          },
        ),
      );
    }
  };

  const uploadDialog = (
    <DocumentUploadDialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) {
          idempotencyKey.current = null;
          setError(null);
          chunked.reset();
        }
        setDialogOpen(next);
      }}
      title={t("documents.upload.version_title")}
      description={t("documents.upload.version_description")}
      hint={t("documents.upload.size_hint", { max: formatDocumentSizeMB(limits.upload_max_bytes, i18n.language) })}
      pending={pending}
      error={error}
      onSubmit={(picked) => void stageNewVersion(picked)}
      chunkedProgress={chunked.progress}
      onPause={chunked.pause}
      onResume={chunked.resume}
      onCancelUpload={(file) => {
        idempotencyKey.current = null;
        setError(null);
        void chunked.cancel(file ?? undefined);
      }}
      hasResumable={(file) => isChunkedFile(file) && chunked.hasResumable(file)}
      onPickFile={() => setError(null)}
    />
  );

  return { download, downloading, openUpload: () => setDialogOpen(true), uploadDialog };
}

/** The file commands as page overflow-menu entries (Office editor mode). */
export function DocumentFileMenuItems({ actions, readonly }: { actions: DocumentFileActions; readonly: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem
        className="gap-2 px-2 py-2"
        disabled={actions.downloading !== null}
        onClick={() => void actions.download()}
      >
        <Download aria-hidden className="size-3.5" />
        {t("documents.actions.download_original")}
      </DropdownMenuItem>
      {!readonly ? (
        <DropdownMenuItem className="gap-2 px-2 py-2" onClick={actions.openUpload}>
          <Upload aria-hidden className="size-3.5" />
          {t("documents.actions.upload_version")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
