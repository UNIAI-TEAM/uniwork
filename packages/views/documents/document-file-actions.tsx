"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDocumentDownload } from "@uniwork/core/documents/hooks";
import type { Document } from "@uniwork/core/types/document";
import { DropdownMenuItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { documentDownloadName } from "./document-download-name";
import { useDocumentVersionUpload } from "./use-document-version-upload";

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
  const versionUpload = useDocumentVersionUpload({
    wsId,
    documentId: doc.id,
    revision: doc.revision,
    versionIdBefore: doc.file?.version_id,
  });
  const [downloading, setDownloading] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const download = async (version?: number) => {
    const target = version === undefined ? "live" : String(version);
    setDownloading(target);
    try {
      const blob = await downloadFile.mutateAsync({ version });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = documentDownloadName(doc);
      anchor.rel = "noopener";
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error(t("documents.file.download_failed"));
    } finally {
      if (mountedRef.current) setDownloading(null);
    }
  };

  return { download, downloading, openUpload: versionUpload.open, uploadDialog: versionUpload.dialog };
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
