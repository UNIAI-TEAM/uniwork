"use client";

import { FolderX, ShieldAlert, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  canBreakGlassFromError,
  isDocumentRestrictedError,
} from "@uniwork/core/api/endpoints/documents";
import {
  useDocumentAdminSummary,
  useGrantDocumentBreakGlass,
  useRevokeDocumentBreakGlass,
} from "@uniwork/core/documents/break-glass-queries";
import { useDocument } from "@uniwork/core/documents/hooks";
import { documentKeys } from "@uniwork/core/documents/keys";
import { useOrgMembers } from "@uniwork/core/organizations";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import type { Document } from "@uniwork/core/types/document";
import type { DocumentBreakGlassGrant } from "@uniwork/core/types/document-access";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageState } from "../layout/collection-page";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { AccessLogSheet } from "./access-log-sheet";
import { DocumentActionsMenu } from "./document-actions-menu";
import { adminRefFromSummary } from "./document-admin-ref";
import { DocumentCommentsPanel } from "./document-comments-panel";
import { DocumentCommentsProvider } from "./document-comments-context";
import { DocumentInboxState } from "./document-inbox-state";
import {
  DocumentBreakGlassBanner,
  DocumentLockedCard,
  getBreakGlassExpiresAt,
  hasAdminScope,
} from "./document-locked-card";
import { DocumentsGateState, useDocumentsGate } from "./documents-gate";
import { DocumentWorkspace } from "./document-workspace";
import { ShareDialog } from "./share-dialog";

/** setTimeout stores a 32-bit delay; a longer wait re-arms itself. */
const MAX_TIMER_MS = 2 ** 31 - 1;

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
  // A grant was made but the document still answers "restricted": the card
  // keeps its place and offers a retry; the workspace never renders on a guess.
  const [grantPending, setGrantPending] = useState(false);
  const [clock, setClock] = useState(0);
  const [grantExpiredOrEnded, setGrantExpiredOrEnded] = useState(false);
  const [endAccessError, setEndAccessError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(accessDeepLink);
  const [accessLogOpen, setAccessLogOpen] = useState(false);

  useEffect(() => {
    if (accessDeepLink) {
      setShareOpen(true);
    }
  }, [accessDeepLink]);

  const restrictedError = Boolean(error && isDocumentRestrictedError(error));
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
  const qc = useQueryClient();
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

  // One timer to the expiry (not polling): the banner flips to the expired
  // card at the stated time and the detail refetches to learn the server's
  // answer. A wait beyond the timer limit re-arms through `clock`.
  useEffect(() => {
    if (!isBreakGlassDoc || !expiresAt) return;
    const at = new Date(expiresAt).getTime();
    if (Number.isNaN(at)) return;
    const wait = at - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setClock((n) => n + 1);
      if (wait <= MAX_TIMER_MS) {
        void qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) });
      }
    }, Math.min(wait, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [isBreakGlassDoc, expiresAt, clock, qc, wsId, documentId]);

  // The locked card names the ACL owner from the member list; an owner the
  // list does not know reads as a neutral label, never as an id.
  const workspaceCtx = useOptionalWorkspace();
  const orgMembers = useOrgMembers(showLockedAdmin ? (workspaceCtx?.workspace.organization_slug ?? "") : "");
  const memberRows = useMemo(
    () => orgMembers.data?.pages.flatMap((page) => page.members) ?? [],
    [orgMembers.data],
  );
  const knownGrantId = activeGrant?.id ?? adminSummary.data?.my_grant?.id;

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

  const refreshAfterGrant = async () => {
    const refreshed = await query.refetch();
    setGrantPending(Boolean(refreshed.error && isDocumentRestrictedError(refreshed.error)));
  };

  const handleGrantBreakGlass = async (reason: string) => {
    const grant = await grantBreakGlass.mutateAsync(reason);
    setActiveGrant(grant);
    setHadBreakGlassSession(true);
    setGrantExpiredOrEnded(false);
    setEndAccessError(null);
    await refreshAfterGrant();
  };

  const handleEndBreakGlass = async () => {
    setEndAccessError(null);
    // The real grant id only: the one just made, the caller's own grant from
    // the admin summary, or the summary read again. A placeholder id is never
    // sent (R21 H3).
    let grantId = knownGrantId;
    if (!grantId) {
      const refreshed = await adminSummary.refetch();
      grantId = refreshed.data?.my_grant?.id;
    }
    if (!grantId) {
      setEndAccessError(t("documents.breakGlass.endAccessFailed"));
      return;
    }
    try {
      setGrantExpiredOrEnded(true);
      await revokeBreakGlass.mutateAsync(grantId);
      setActiveGrant(null);
      setGrantPending(false);
      await query.refetch();
    } catch {
      setGrantExpiredOrEnded(false);
      setEndAccessError(t("documents.breakGlass.endAccessFailed"));
    }
  };

  // The share dialog and the access log take a narrow reference: the real
  // document when it loaded, else the admin summary. Never a made-up Document.
  const summaryDoc = adminSummary.data?.document;
  const adminRef = query.data
    ? query.data
    : adminSummary.data
      ? {
          ...adminRefFromSummary(adminSummary.data),
          organization_id:
            adminSummary.data.document.organization_id || workspaceCtx?.workspace.organization_id || "",
        }
      : null;

  if (showLockedAdmin) {
    const ownerId = adminSummary.data?.acl_owner?.user_id;
    const ownerName = ownerId
      ? memberRows.find((m) => m.user_id === ownerId)?.display_name || t("documents.breakGlass.ownerFallback")
      : null;
    const lockedMetadata = {
      title: summaryDoc?.title ?? query.data?.title ?? null,
      ownerName,
      visibility: summaryDoc?.visibility ?? query.data?.visibility ?? "restricted",
      updatedAt: summaryDoc?.updated_at ?? query.data?.updated_at ?? null,
      sizeBytes: summaryDoc?.size_bytes ?? null,
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
          expired={
            !grantPending &&
            (grantExpiredOrEnded || isTimestampExpired || (restrictedError && hadBreakGlassSession))
          }
          grantPending={grantPending}
          onRetryOpen={() => void refreshAfterGrant()}
          isSubmitting={grantBreakGlass.isPending}
          onGrantBreakGlass={handleGrantBreakGlass}
          onShare={canBreakGlass && adminRef ? () => setShareOpen(true) : undefined}
          onOpenAccessLog={canBreakGlass && adminRef ? () => setAccessLogOpen(true) : undefined}
        />
        {adminRef ? (
          <>
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              wsId={wsId}
              doc={adminRef}
              initialSection={accessDeepLink ? "break_glass" : undefined}
            />
            <AccessLogSheet
              open={accessLogOpen}
              onOpenChange={setAccessLogOpen}
              wsId={wsId}
              doc={adminRef}
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

  // The workspace renders only from a real GET answer.
  const resolvedDoc = query.data ?? null;

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
              endDisabled={!knownGrantId && adminSummary.isPending}
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

