"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useDownloadDocumentFile } from "@uniwork/core/documents/hooks-library";
import { isLegacyOfficeFormat } from "@uniwork/core/office/office-modules";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { useNavigation } from "../navigation";
import { LegacyFormatDialog } from "../office/legacy-format-dialog";
import { DocumentCopyDialog } from "./document-copy-dialog";
import { documentDownloadName } from "./document-download-name";
import type { LibraryDesktopOpen } from "./documents-library-row";
import type { DocumentSummaryRow } from "./library-rows";
import { rowAppOperation } from "./row-level";

export type OpenableDocumentItem = {
  id: string;
  kind?: string;
  title?: string;
  format?: string | null;
  organization_id?: string;
  current_version?: number;
  my_level?: string | null;
  admin_scope?: boolean;
};

export interface LibraryRowFileCommands {
  onCopyLink: (doc: DocumentSummaryRow) => void;
  onDuplicate: (doc: DocumentSummaryRow) => void;
  onDownload: (doc: DocumentSummaryRow) => void;
  openDocument: (documentId: string, item?: OpenableDocumentItem) => void;
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
  orgId,
  documentHref,
  onOpen,
  docById,
  desktopOpen,
}: {
  wsId: string;
  orgId: string;
  /** The in-app path of a document, from the `paths` builder; the host's `getShareableUrl` makes it an absolute address. */
  documentHref: (documentId: string) => string;
  onOpen: (documentId: string) => void;
  docById: ReadonlyMap<string, DocumentSummaryRow>;
  desktopOpen?: LibraryDesktopOpen;
}): LibraryRowFileCommands {
  const { t } = useTranslation();
  const { getShareableUrl } = useNavigation();
  const download = useDownloadDocumentFile();
  const [copying, setCopying] = useState<DocumentSummaryRow | null>(null);
  const [legacyTarget, setLegacyTarget] = useState<OpenableDocumentItem | null>(null);

  const openDocument = (documentId: string, item?: OpenableDocumentItem) => {
    const known = docById.get(documentId) ?? item;
    if (known && known.kind !== "page" && known.kind !== "folder" && isLegacyOfficeFormat({ format: known.format, filename: known.title })) {
      setLegacyTarget(known);
      return;
    }
    onOpen(documentId);
  };

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

  const legacyOrgId = legacyTarget?.organization_id || orgId;
  const legacySavedVersion = legacyTarget?.current_version && legacyTarget.current_version > 0 ? legacyTarget.current_version : 1;
  const legacyOperation = rowAppOperation(legacyTarget);

  const dialogs = (
    <>
      {copying ? (
        <DocumentCopyDialog
          open
          onOpenChange={(next) => {
            if (!next) setCopying(null);
          }}
          wsId={wsId}
          doc={copying}
        />
      ) : null}
      {legacyTarget ? (
        <LegacyFormatDialog
          open
          onOpenChange={(next) => {
            if (!next) setLegacyTarget(null);
          }}
          documentId={legacyTarget.id}
          savedVersion={legacySavedVersion}
          operation={legacyOperation}
          desktopOpen={desktopOpen?.({ id: legacyTarget.id, organization_id: legacyOrgId, current_version: legacySavedVersion })}
        />
      ) : null}
    </>
  );

  return { onCopyLink, onDuplicate: setCopying, onDownload, openDocument, dialogs };
}
