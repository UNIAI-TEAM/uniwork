"use client";

import { ShieldAlert, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { clearDocumentAccessRequestSent } from "@uniwork/core/documents/hooks-access-requests";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { useOptionalNavigation } from "../navigation";
import { DocumentActionsMenu } from "./document-actions-menu";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { DocumentCommentsProvider } from "./document-comments-context";
import { DocumentInboxState } from "./document-inbox-state";
import { DocumentLockedCard } from "./document-locked-card";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { DocumentWorkspace } from "./document-workspace";
import { useRequestSourceFromUrl } from "./use-request-source-from-url";

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
  // A link that names a comment came from the Inbox (or its push): its refusals are the
  // S15 page messages with the way back to the Inbox (UNI-1389 rows 1-2).
  const fromInbox = (useOptionalNavigation()?.searchParams.get("comment") ?? "") !== "";
  const requestSource = useRequestSourceFromUrl(documentId);
  const loaded = !!query.data;
  // An open document ends any request this device sent for it (F-08).
  useEffect(() => {
    if (loaded) clearDocumentAccessRequestSent(documentId);
  }, [loaded, documentId]);

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
    if (fromInbox) return <DocumentInboxState reason="no_access" className="mx-auto w-full max-w-3xl" />;
    // DOC-05: an admin is refused a restricted document's content, never its management.
    if (classifyDocumentError(error).code === "document_restricted") {
      return <DocumentLockedCard key={documentId} variant="admin" wsId={wsId} documentId={documentId} onBack={onBackToList} />;
    }
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={CircleX}
        title={t("documents.detail.revoked_title")}
        description={t("documents.detail.revoked_description")}
        tone="destructive"
        role="alert"
        actions={backAction}
      />
    );
  }

  if (!query.data) {
    if (fromInbox && (errorClass === "missing" || errorClass === "gone")) {
      return <DocumentInboxState reason="gone" className="mx-auto w-full max-w-3xl" />;
    }
    // DOC-07: a 404 (missing, unshared or another organization's, on purpose
    // indistinguishable) is the member locked card with a way to ask for access.
    if (errorClass === "missing") {
      return (
        <DocumentLockedCard
          key={documentId}
          variant="member"
          wsId={wsId}
          documentId={documentId}
          source={requestSource}
          onRetryOpen={() => void query.refetch()}
          retrying={query.isFetching}
          onBack={onBackToList}
        />
      );
    }
    // An unreachable server is not a refusal: it says so and offers the load again.
    return (
      <CollectionPageState
        className="mx-auto w-full max-w-3xl"
        icon={ShieldAlert}
        title={t("documents.detail.load_error")}
        description={t("documents.detail.load_error_description")}
        tone="destructive"
        role="alert"
        actions={
          <>
            {backAction}
            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden className="size-3.5" />
              {t("documents.detail.retry")}
            </Button>
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
