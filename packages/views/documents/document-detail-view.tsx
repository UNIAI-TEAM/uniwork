"use client";

import { FolderX, ShieldAlert, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useDocument } from "@uniwork/core/documents/hooks";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { useOptionalNavigation } from "../navigation";
import { AccessLogSheet } from "./access-log-sheet";
import { DocumentActionsMenu } from "./document-actions-menu";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { DocumentCommentsProvider } from "./document-comments-context";
import { DocumentInboxState } from "./document-inbox-state";
import {
  canBreakGlassFromError,
  DocumentBreakGlassBanner,
  DocumentLockedCard,
  getBreakGlassExpiresAt,
  hasAdminScope,
  isDocumentRestrictedError,
  useDocumentAdminSummary,
  useGrantDocumentBreakGlass,
  useRevokeDocumentBreakGlass,
  type DocumentBreakGlassGrant,
} from "./document-locked-card";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { DocumentWorkspace } from "./document-workspace";
import { ShareDialog } from "./share-dialog";

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
  const nav = useOptionalNavigation();
  // A link that names a comment came from the Inbox (or its push): its refusals are the
  // S15 page messages with the way back to the Inbox (UNI-1389 rows 1-2).
  const fromInbox = (nav?.searchParams.get("comment") ?? "") !== "";
  const accessDeepLink = nav?.searchParams.get("access") === "break_glass";

  const [activeGrant, setActiveGrant] = useState<DocumentBreakGlassGrant | null>(null);
  const [hadBreakGlassSession, setHadBreakGlassSession] = useState(false);
  const [bypassRestrictedAfterGrant, setBypassRestrictedAfterGrant] = useState(false);
  const [grantExpiredOrEnded, setGrantExpiredOrEnded] = useState(false);
  const [endAccessError, setEndAccessError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(accessDeepLink);
  const [accessLogOpen, setAccessLogOpen] = useState(false);

  useEffect(() => {
    if (accessDeepLink) {
      setShareOpen(true);
    }
  }, [accessDeepLink]);

  const restrictedError = Boolean(
    error && isDocumentRestrictedError(error) && !bypassRestrictedAfterGrant,
  );
  const adminScopeLocked = Boolean(
    !error && query.data && hasAdminScope(query.data) && !query.data.my_level,
  );
  const isBreakGlassDoc = Boolean(
    !restrictedError &&
      !grantExpiredOrEnded &&
      (query.data?.via === "break_glass" ||
        activeGrant !== null ||
        getBreakGlassExpiresAt(query.data) !== undefined),
  );

  useEffect(() => {
    if (isBreakGlassDoc) {
      setHadBreakGlassSession(true);
    }
  }, [isBreakGlassDoc]);

  const adminSummary = useDocumentAdminSummary(
    wsId,
    documentId,
    enabled && (restrictedError || adminScopeLocked || isBreakGlassDoc),
  );
  const grantBreakGlass = useGrantDocumentBreakGlass(wsId, documentId);
  const revokeBreakGlass = useRevokeDocumentBreakGlass(wsId, documentId);

  const expiresAt =
    activeGrant?.expires_at ??
    getBreakGlassExpiresAt(query.data) ??
    adminSummary.data?.my_grant?.expires_at ??
    null;

  const isTimestampExpired = Boolean(
    expiresAt && !Number.isNaN(new Date(expiresAt).getTime()) && new Date(expiresAt).getTime() <= Date.now(),
  );
  const showLockedAdmin =
    restrictedError || adminScopeLocked || grantExpiredOrEnded || (isBreakGlassDoc && isTimestampExpired);

  const canBreakGlass = error && isDocumentRestrictedError(error) ? canBreakGlassFromError(error) : true;

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

  const handleGrantBreakGlass = async (reason: string) => {
    const res = await grantBreakGlass.mutateAsync(reason);
    setActiveGrant(res.grant);
    setHadBreakGlassSession(true);
    setGrantExpiredOrEnded(false);
    setEndAccessError(null);
    const refreshed = await query.refetch();
    setBypassRestrictedAfterGrant(
      Boolean(refreshed.error && isDocumentRestrictedError(refreshed.error)),
    );
  };

  const handleEndBreakGlass = async () => {
    setEndAccessError(null);
    const grantId =
      activeGrant?.id ??
      adminSummary.data?.my_grant?.id ??
      (query.data as { break_glass_grant_id?: string } | undefined)?.break_glass_grant_id ??
      "current";
    try {
      setGrantExpiredOrEnded(true);
      await revokeBreakGlass.mutateAsync(grantId);
      setActiveGrant(null);
      setBypassRestrictedAfterGrant(false);
      await query.refetch();
    } catch {
      setGrantExpiredOrEnded(false);
      setEndAccessError(t("documents.breakGlass.endAccessFailed"));
    }
  };

  const summaryDoc = adminSummary.data?.document;
  const shellDocForAdminModals: Document | null =
    query.data ??
    (summaryDoc
      ? ({
          id: summaryDoc.id || documentId,
          organization_id: summaryDoc.organization_id ?? "org-1",
          workspace_id: summaryDoc.workspace_id ?? wsId,
          parent_id: summaryDoc.parent_id ?? null,
          kind: (summaryDoc.kind as Document["kind"]) ?? "page",
          title: summaryDoc.title || "",
          icon: summaryDoc.icon ?? null,
          content: {},
          content_text: "",
          file_key: null,
          mime_type: null,
          size_bytes: summaryDoc.size_bytes ?? 0,
          checksum: null,
          current_version: 1,
          visibility: (summaryDoc.visibility as Document["visibility"]) ?? "restricted",
          owner_kind: null,
          owner_id: null,
          revision: "1",
          archived_at: summaryDoc.archived_at ?? null,
          archived_by: null,
          archived_by_kind: null,
          archive_root_id: null,
          created_by: summaryDoc.created_by ?? "u-1",
          created_by_kind: "human",
          updated_by: null,
          updated_by_kind: null,
          created_at: summaryDoc.created_at ?? "2026-10-14T00:00:00Z",
          updated_at: summaryDoc.updated_at ?? "2026-10-14T00:00:00Z",
          my_level: "manage",
          admin_scope: true,
        } as Document)
      : null);

  if (showLockedAdmin) {
    const lockedMetadata = {
      title: summaryDoc?.title ?? query.data?.title ?? null,
      ownerName: adminSummary.data?.acl_owner?.user_id ?? null,
      visibility: summaryDoc?.visibility ?? query.data?.visibility ?? "restricted",
      updatedAt: summaryDoc?.updated_at ?? query.data?.updated_at ?? null,
      sizeBytes: summaryDoc?.size_bytes ?? query.data?.size_bytes ?? null,
    };

    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          {backAction}
        </div>
        <DocumentLockedCard
          variant="admin"
          metadata={lockedMetadata}
          canBreakGlass={canBreakGlass}
          expired={grantExpiredOrEnded || isTimestampExpired || (restrictedError && hadBreakGlassSession)}
          isSubmitting={grantBreakGlass.isPending}
          onGrantBreakGlass={handleGrantBreakGlass}
          onShare={canBreakGlass && shellDocForAdminModals ? () => setShareOpen(true) : undefined}
          onOpenAccessLog={
            canBreakGlass && shellDocForAdminModals ? () => setAccessLogOpen(true) : undefined
          }
        />
        {shellDocForAdminModals ? (
          <>
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              wsId={wsId}
              doc={shellDocForAdminModals}
              initialSection={accessDeepLink ? "break_glass" : undefined}
            />
            <AccessLogSheet
              open={accessLogOpen}
              onOpenChange={setAccessLogOpen}
              wsId={wsId}
              doc={shellDocForAdminModals}
            />
          </>
        ) : null}
      </div>
    );
  }

  // Losing read access hides the copy already on screen — and a first load
  // that is refused reads the same way, never as a load error.
  if (error && errorClass === "permission") {
    if (fromInbox) return <DocumentInboxState reason="no_access" className="mx-auto w-full max-w-3xl" />;
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

  const resolvedDoc = query.data ?? (activeGrant ? shellDocForAdminModals : null);

  if (!resolvedDoc) {
    if (fromInbox && (errorClass === "missing" || errorClass === "gone")) {
      return <DocumentInboxState reason="gone" className="mx-auto w-full max-w-3xl" />;
    }
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
                <RefreshCw aria-hidden className="size-3.5" />
                {t("documents.detail.retry")}
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  const workspaceDoc: Document = isBreakGlassDoc
    ? { ...resolvedDoc, my_level: "view", via: "break_glass" }
    : resolvedDoc;

  return (
    <DocumentCommentsProvider wsId={wsId} doc={workspaceDoc}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isBreakGlassDoc ? (
          <div className="px-4 pt-3">
            <DocumentBreakGlassBanner
              expiresAt={expiresAt}
              isEnding={revokeBreakGlass.isPending}
              error={endAccessError}
              onEndAccess={handleEndBreakGlass}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <DocumentWorkspace
            // Keyed by document: the editor reads its content once at mount, and
            // useDocumentSave owns one machine per document, so a host that reuses
            // this view for another id must remount rather than re-point either.
            key={workspaceDoc.id}
            wsId={wsId}
            doc={workspaceDoc}
            libraryHref={libraryHref}
            documentHref={documentHref}
            ownerHref={ownerHref}
            refetch={() => query.refetch()}
            officeEditorHost={officeEditorHost}
            headerActions={
              <DocumentActionsMenu
                wsId={wsId}
                doc={resolvedDoc}
                documentHrefFor={documentHref}
                onArchived={onBackToList}
              />
            }
          />
          <DocumentCommentsPanel />
        </div>
        {!resolvedDoc.owner_kind && shareOpen ? (
          <ShareDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            wsId={wsId}
            doc={resolvedDoc}
            initialSection={accessDeepLink ? "break_glass" : undefined}
          />
        ) : null}
      </div>
    </DocumentCommentsProvider>
  );
}

