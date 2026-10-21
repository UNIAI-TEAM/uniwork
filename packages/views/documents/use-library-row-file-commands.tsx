"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useDownloadDocumentFile } from "@uniwork/core/documents/hooks-library";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { useNavigation } from "../navigation";
import { DocumentCopyDialog } from "./document-copy-dialog";
import { documentDownloadName } from "./document-download-name";
import type { DocumentSummaryRow } from "./library-rows";

export interface LibraryRowFileCommands {
  onCopyLink: (doc: DocumentSummaryRow) => void;
  onDuplicate: (doc: DocumentSummaryRow) => void;
  onDownload: (doc: DocumentSummaryRow) => void;
  dialogs: ReactNode;
}

/**
 * The three row-menu commands that act on one document (UNI-2045 W8): copy
 * its in-app link, make a copy of a file, download a file. Each goes through
 * what the document page already uses: the copy dialog asks for the consent
 * the copies route requires, and the download is the existing download route.
 */
export function useLibraryRowFileCommands({
  wsId,
  documentHref,
}: {
  wsId: string;
  /** The in-app path of a document, from the `paths` builder; the host's `getShareableUrl` makes it an absolute address. */
  documentHref: (documentId: string) => string;
}): LibraryRowFileCommands {
  const { t } = useTranslation();
  const { getShareableUrl } = useNavigation();
  const download = useDownloadDocumentFile();
  const [copying, setCopying] = useState<DocumentSummaryRow | null>(null);

  const onCopyLink = (doc: DocumentSummaryRow) => {
    // The address the app shows for the document, never a public (share) link.
    void copyText(getShareableUrl(documentHref(doc.id))).then((copied) => {
      if (copied) toast.success(t("documents.list.menu.link_copied"));
      else toast.error(t("documents.list.menu.link_copy_failed"));
    });
  };

  const onDownload = (doc: DocumentSummaryRow) => {
    void download.mutateAsync({ documentId: doc.id }).then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement("a");
        link.href = url;
        link.download = documentDownloadName(doc);
        link.rel = "noopener";
        window.document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      (error: unknown) => toast.error(apiErrorMessage(error) ?? t("documents.home.row.download_failed")),
    );
  };

  const dialogs = copying ? (
    <DocumentCopyDialog
      open
      onOpenChange={(next) => {
        if (!next) setCopying(null);
      }}
      wsId={wsId}
      doc={copying}
    />
  ) : null;

  return { onCopyLink, onDuplicate: setCopying, onDownload, dialogs };
}
