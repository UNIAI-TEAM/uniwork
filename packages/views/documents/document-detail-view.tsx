"use client";

import { FileWarning, FolderX, RotateCw, ShieldAlert, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useFlag } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { DocumentCommentsProvider } from "./document-comments-context";
import { DocumentWorkspace } from "./document-workspace";

export interface DocumentDetailViewProps {
  wsId: string;
  documentId: string;
  /** The library list, the one breadcrumb ancestor we can point at today. */
  libraryHref: string;
  /** Called when the caller should go back to the library. */
  onBackToList: () => void;
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
  onBackToList,
}: DocumentDetailViewProps) {
  const { t } = useTranslation();
  const enabled = useFlag("documents", false);
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

  if (!enabled) {
    return (
      <CollectionPageState
        icon={FileWarning}
        title={t("documents.page.off_title")}
        description={t("documents.page.off_description")}
        role="status"
      />
    );
  }

  if (query.isPending) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Losing read access hides the copy already on screen — and a first load
  // that is refused reads the same way, never as a load error.
  if (error && errorClass === "permission") {
    return (
      <CollectionPageState
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
          refetch={() => query.refetch()}
        />
        <DocumentCommentsPanel />
      </div>
    </DocumentCommentsProvider>
  );
}
