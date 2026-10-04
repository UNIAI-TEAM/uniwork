"use client";

import { useRef, useState, type ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useDocumentDownload, useUploadDocumentFile } from "@uniwork/core/documents/hooks";
import { useCommitDocumentVersion } from "@uniwork/core/documents/hooks-versions";
import type { Document } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { DocumentUploadDialog } from "./document-upload-dialog";

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
  const { t } = useTranslation();
  const downloadFile = useDocumentDownload(wsId, doc.id);
  const upload = useUploadDocumentFile(wsId, doc.id);
  const commit = useCommitDocumentVersion(wsId, doc.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // One key per user intent: a retry of the same pick must replay the same
  // write, not mint a second version of one upload.
  const idempotencyKey = useRef<string | null>(null);
  const pending = upload.isPending || commit.isPending;

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
    setError(null);
    idempotencyKey.current ??= createSafeId();
    let staged = false;
    try {
      const upload0 = await upload.mutateAsync({
        file: picked,
        idempotencyKey: idempotencyKey.current,
      });
      staged = true;
      await commit.mutateAsync({
        upload_id: upload0.upload_id,
        base_revision: doc.revision,
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = null;
      setDialogOpen(false);
    } catch (err) {
      setError(
        apiErrorMessage(err) ??
          t(staged ? "documents.file.commit_failed" : "documents.file.upload_failed"),
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
        }
        setDialogOpen(next);
      }}
      title={t("documents.upload.version_title")}
      description={t("documents.upload.version_description")}
      hint={t("documents.upload.size_hint")}
      pending={pending}
      error={error}
      onSubmit={(picked) => void stageNewVersion(picked)}
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
