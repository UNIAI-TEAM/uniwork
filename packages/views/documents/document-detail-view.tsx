"use client";

import { FolderX, RotateCw, ShieldAlert, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { DocumentActionsMenu } from "./document-actions-menu";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { DocumentCommentsProvider } from "./document-comments-context";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { DocumentWorkspace } from "./document-workspace";

export interface DocumentDetailViewProps {
  wsId: string;
  documentId: string;
  /** The library list, the one breadcrumb ancestor we can point at today. */
  libraryHref: string;
  /**
   * Builds the URL of another document in this workspace, for the breadcrumb
   * ancestors the server proved readable. Absent, ancestors are not linked.
   */
  documentHref?: (documentId: string) => string;
  /**
   * Builds the URL of the Work Product that owns this document; an owned
   * document's chain starts there instead of the library (C-01 §13.5).
   */
  ownerHref?: (ownerId: string) => string;
  /** Called when the caller should go back to the library. */
  onBackToList: () => void;
  officeEditorHost?: ComponentType<{ wsId: string; document: Document; readonly: boolean }>;
}

/**
 * `/documents/{id}`: flag gate, load states, then the workspace.
 *
 * Every failure branch is a `CollectionPageState` — the screen never leaves a
 * blank canvas, and it never shows content it may not show: a document whose
 * read access was revoked renders the revoked state even when a copy is still
 * sitting in the query cache.
 */
export function DocumentDetailView({
  wsId,
  documentId,
  libraryHref,
  documentHref,
  ownerHref,
  onBackToList,
  officeEditorHost,
}: DocumentDetailViewProps) {
  const { t } = useTranslation();
  const { gate, retry: retryGate } = useDocumentsGate();
  const enabled = gate === "on";
  const query = useDocument(wsId, documentId, { enabled });
  const error = query.error;
  // error_class first, then the stable code, then the status: a 403 that
  // arrives without a stamp must still read as "no access", not as a crash.
  const errorClass = error ? classifyDocumentError(error).cls : undefined;

  const backAction = (
    <Button type="button" variant="outline" size="sm" onClick={onBackToList}>
      {t("documents.detail.back_to_library")}
    </Button>
  );

  if (gate !== "on") {
    return <DocumentsGateState gate={gate} retry={retryGate} className="mx-auto w-full max-w-3xl" />;
  }

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-12 md:pt-16" aria-busy="true">
        <Skeleton className="mb-8 h-10 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  // Losing read access hides the copy already on screen — and a first load
  // that is refused reads the same way, never as a load error.
  if (error && errorClass === "permission") {
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={XCircle}
        title={t("documents.detail.revoked_title")}
        description={t("documents.detail.revoked_description")}
        tone="destructive"
        role="alert"
        actions={backAction}
      />
    );
  }

  if (!query.data) {
    // 404 and an unreachable server are answered differently on purpose; both
    // keep the id's existence out of the copy the user sees.
    const missing = errorClass === "missing";
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={missing ? FolderX : ShieldAlert}
        title={missing ? t("documents.detail.not_found") : t("documents.detail.load_error")}
        description={missing ? undefined : t("documents.detail.load_error_description")}
        tone={missing ? "muted" : "destructive"}
        role="alert"
        actions={
          <>
            {backAction}
            {!missing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                <RotateCw aria-hidden className="size-3.5" />
                {t("documents.detail.retry")}
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <DocumentCommentsProvider wsId={wsId} doc={query.data}>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <DocumentWorkspace
          // Keyed by document: the editor reads its content once at mount, and
          // useDocumentSave owns one machine per document, so a host that reuses
          // this view for another id must remount rather than re-point either.
          key={query.data.id}
          wsId={wsId}
          doc={query.data}
          libraryHref={libraryHref}
          documentHref={documentHref}
          ownerHref={ownerHref}
          refetch={() => query.refetch()}
          officeEditorHost={officeEditorHost}
          headerActions={
            <DocumentActionsMenu
              wsId={wsId}
              doc={query.data}
              documentHrefFor={documentHref}
              onArchived={onBackToList}
            />
          }
        />
        <DocumentCommentsPanel />
      </div>
    </DocumentCommentsProvider>
  );
}
