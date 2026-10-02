"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, Eye, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { useDocumentSave, useUploadDocumentAsset } from "@uniwork/core/documents/hooks";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import type { BreadcrumbSegment } from "../layout/breadcrumb-header";
import { PAGE_GUTTER, PAGE_LEADING_ICON } from "../layout/page-header";
import { Notice } from "../common/notice";
import { leaveGuardAllows, registerLeaveGuard, useNavigation } from "../navigation";
import type { DocumentAssetUploader } from "./document-asset-upload";
import { DocumentCommentsHeaderActions } from "./document-comments-context";
import { DocumentConflictDialog } from "./conflict-dialog";
import type { DocumentEditorHandle } from "./document-editor";
import { DocumentFileView } from "./document-file-view";
import { DocumentSaveIndicator } from "./document-save-indicator";
import { DocumentPageHeader } from "./document-page-header";
import { newerPageRevision, type DocumentPageMetadataHandle, type DocumentPageMetadataStatus } from "./use-document-page-metadata";

/**
 * The editor chunk. The document route must stay inside the bundle budget, so
 * TipTap arrives through React.lazy from a shared view (never next/dynamic:
 * packages/views has no framework router).
 */
const DocumentEditor = lazy(() =>
  import("./document-editor").then((mod) => ({ default: mod.DocumentEditor })),
);

export interface DocumentWorkspaceProps {
  wsId: string;
  doc: Document;
  /** The library list, the one breadcrumb ancestor we can point at today. */
  libraryHref: string;
  /**
   * Builds the URL of another document in this workspace, for the breadcrumb
   * ancestors. Absent, ancestors stay out of the chain: a link is never
   * pointed at a URL that does not address the ancestor.
   */
  documentHref?: (documentId: string) => string;
  /**
   * Builds the URL of the Work Product that owns this document. Owned
   * documents are not in the library at all (C-01 §13.5), so their chain
   * starts at the owner page.
   */
  ownerHref?: (ownerId: string) => string;
  /**
   * Actions the detail host adds to the header (G1-08's menu). Rendered
   * before the save indicator so the menu is the last, stable control.
   */
  headerActions?: ReactNode;
  /**
   * Re-read the document from the server (conflict resolution). The result is
   * the query observer's snapshot: a refetch that fails resolves with the
   * stale cache entry and `isError`, so the copy that comes back here can
   * never be assumed fresh.
   */
  refetch: () => Promise<{ data?: Document | null; isError?: boolean }>;
  officeEditorHost?: ComponentType<{ wsId: string; document: Document; readonly: boolean }>;
}

/**
 * One loaded document: header, save state, canvas, and the two dialogs that
 * guard a user's unsaved bytes (version conflict, leaving the page).
 *
 * Save wiring is deliberately in this component rather than in the editor:
 * `useDocumentSave` owns one machine per document, so switching documents
 * unmounts a machine instead of re-pointing one at another document's
 * revision. A callback from the previous document can therefore never write
 * into the next one.
 */
export function DocumentWorkspace({
  wsId,
  doc,
  libraryHref,
  documentHref,
  ownerHref,
  headerActions,
  refetch,
  officeEditorHost,
}: DocumentWorkspaceProps) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const save = useDocumentSave(wsId, doc.id, doc.revision);
  const uploadAsset = useUploadDocumentAsset(wsId, doc.id);
  const state = save.state as DocumentSaveState;

  const canEdit = doc.my_level === "edit" || doc.my_level === "manage";
  const editorRef = useRef<DocumentEditorHandle>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [pageTitle, setPageTitle] = useState(doc.title);
  const metadataRef = useRef<DocumentPageMetadataHandle>(null);
  const [metadataStatus, setMetadataStatus] = useState<DocumentPageMetadataStatus>({ dirty: false, pending: false, failed: false });
  const metadataStatusRef = useRef(metadataStatus);
  const queuedBodyRef = useRef<unknown>(undefined);
  const [bodyQueued, setBodyQueued] = useState(false);
  const bodyQueuedRef = useRef(false);
  const handleMetadataStatus = useCallback((next: DocumentPageMetadataStatus) => {
    metadataStatusRef.current = next;
    setMetadataStatus((previous) => previous.dirty === next.dirty && previous.pending === next.pending
      && previous.failed === next.failed ? previous : next);
  }, []);
  const lastLocalContentRef = useRef<unknown>(undefined);
  const stateRef = useRef(state);
  const [pendingUploads, setPendingUploads] = useState(0);
  const pendingUploadsRef = useRef(0);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [serverBase, setServerBase] = useState<{
    revision: string;
    updatedAt: string | null;
    contentText: string | null;
  } | null>(null);
  const [keepMinePending, setKeepMinePending] = useState(false);
  const [keepMineError, setKeepMineError] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [leaveRecheck, setLeaveRecheck] = useState(0);
  const leaveResolveRef = useRef<((allowed: boolean) => void) | null>(null);
  const leaveDoneRef = useRef(false);

  stateRef.current = state;
  bodyQueuedRef.current = bodyQueued;
  pendingUploadsRef.current = pendingUploads;
  const dirty = state.dirty || bodyQueued;
  /**
   * Unsaved means "bytes the server has not acknowledged": a draft, or an
   * upload still in flight whose result has not reached the document yet. The
   * indicator already refuses to call an in-flight upload saved; the guard has
   * to use the same definition or the image is lost without a word.
   */
  const hasUnsavedWork = useCallback(
    () => stateRef.current.dirty || bodyQueuedRef.current || pendingUploadsRef.current > 0 || Boolean(metadataRef.current?.hasUnsavedWork()),
    [],
  );

  // The machine stops on a stale base; the dialog is the only way forward.
  useEffect(() => {
    if (state.phase === "conflict") setConflictOpen(true);
  }, [state.phase]);

  // Another writer (or a refetch) moved the base while we were clean: adopt it.
  useEffect(() => {
    if (!dirty && newerPageRevision(stateRef.current.revision, doc.revision) === doc.revision) save.updateBase(doc.revision, doc);
    // `save` is rebuilt on every state change on purpose: updateBase is a no-op
    // unless the machine is clean, and a stale closure here would miss a base.
  }, [doc.revision, doc, dirty, save]);

  // Title/icon and body share one revision. Keep typing live, but hand the
  // newest body to the existing save machine only after metadata settles.
  // The queued flag protects the editor from adopting the old body in its ACK.
  useEffect(() => {
    if (metadataStatus.pending || !bodyQueued || queuedBodyRef.current === undefined) return;
    const content = queuedBodyRef.current;
    queuedBodyRef.current = undefined;
    save.edit({ content });
    setBodyQueued(false);
  }, [metadataStatus.pending, bodyQueued, save]);

  /* ---- leaving with unsaved changes (C-01 §7.3, FE design §5.4) ---- */

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Best effort and a warning only: the 2 MiB page JSON cannot be promised
      // over a keepalive body, so the guard is the in-app dialog, not this.
      if (!hasUnsavedWork()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);

  useEffect(
    () =>
      registerLeaveGuard(() => {
        if (!hasUnsavedWork()) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          // A second guarded navigation while the dialog is open (double click,
          // sidebar plus breadcrumb) must not swallow the first one.
          leaveResolveRef.current?.(false);
          leaveResolveRef.current = resolve;
          leaveDoneRef.current = false;
          setLeaveOpen(true);
        });
      }),
    [hasUnsavedWork],
  );

  const finishLeave = useCallback((allowed: boolean) => {
    const resolve = leaveResolveRef.current;
    leaveResolveRef.current = null;
    setLeaveOpen(false);
    setLeavePending(false);
    resolve?.(allowed);
  }, []);

  /**
   * "Save and leave" waits for the whole write, uploads included: an image
   * still going up is not saved work, and its node only exists in the document
   * once the asset answers.
   *
   * The wait rides state transitions, it never re-sends: a write that failed
   * for good ("error" / "unverifiable") is terminal for the attempt — flushing
   * the same draft again would replay the same failing request in a loop — and
   * a conflict hands the decision to the conflict dialog. A failed attempt
   * leaves the dialog open with its buttons enabled, so the user can retry,
   * discard or stay.
   */
  useEffect(() => {
    if (!leavePending || leaveDoneRef.current) return;
    if (bodyQueued) return;
    if (pendingUploads > 0) return;
    if (state.phase === "saving" || state.phase === "debouncing") return;
    if (!state.dirty && state.phase !== "conflict" && metadataRef.current?.hasUnsavedWork()) {
      // Metadata shares the leave policy, while its PATCH stays outside the
      // content save machine. Await an existing flight instead of re-sending.
      leaveDoneRef.current = true;
      const resolve = leaveResolveRef.current;
      void metadataRef.current.flush().then((saved) => {
        if (leaveResolveRef.current !== resolve) return;
        if (saved && !hasUnsavedWork()) finishLeave(true);
        else if (!metadataStatusRef.current.failed && (bodyQueuedRef.current || stateRef.current.dirty)) {
          leaveDoneRef.current = false;
          setLeaveRecheck((value) => value + 1);
        } else setLeavePending(false);
      });
      return;
    }
    if (state.phase === "saved" && !state.dirty) {
      leaveDoneRef.current = true;
      finishLeave(true);
      return;
    }
    if (state.phase === "error" || state.phase === "unverifiable") {
      // Terminal for this attempt: stop waiting (the caption shows the
      // failure); "save and leave" retries deliberately, one flush per click.
      leaveDoneRef.current = true;
      setLeavePending(false);
      return;
    }
    if (state.phase === "conflict") {
      // The base moved under the write: the conflict dialog owns the next
      // step, and leaving stays refused until the user resolves it.
      leaveDoneRef.current = true;
      finishLeave(false);
      setConflictOpen(true);
      setServerBase(null);
      return;
    }
    if (state.dirty) {
      // A draft with no request in flight (it landed while an upload was
      // settling): send it now. One flush per transition; a failure lands in
      // the terminal branch above.
      save.flush();
      return;
    }
    leaveDoneRef.current = true;
    setLeavePending(false);
  }, [leavePending, leaveRecheck, bodyQueued, pendingUploads, state.phase, state.dirty, metadataStatus.pending, metadataStatus.dirty, save, finishLeave, hasUnsavedWork]);

  const saveThenLeave = () => {
    leaveDoneRef.current = false;
    setLeavePending(true);
    save.flush();
  };

  /** In-view navigation goes through the same guard the host adapter runs. */
  const navigate = useCallback(
    (href: string) => {
      void leaveGuardAllows(href).then((allowed) => {
        if (allowed) push(href);
      });
    },
    [push],
  );

  /* ---- conflict resolution (C-01 §7.3, FE design §6.3) ---- */

  /**
   * Step one of "keep mine": read the server's CURRENT base and show it. The
   * revision in the error is only what the failed save saw; the user has to
   * see what they are about to write on top of before anything is committed.
   *
   * A refetch that fails resolves with the stale cached copy, not a rejection
   * (TanStack), and a copy older than the conflict's `current_revision` is
   * known to be stale — neither may be shown as "the newest server copy", so
   * the dialog stays on step one with an error and waits for a retry.
   */
  const keepMine = () => {
    setKeepMineError(false);
    setKeepMinePending(true);
    void refetch().then((fresh) => {
      setKeepMinePending(false);
      const next = fresh.data ?? null;
      const current = Number(stateRef.current.errorFields?.current_revision ?? 0);
      const revision = Number(next?.revision ?? Number.NaN);
      if (!next || fresh.isError || !(revision >= current)) {
        setKeepMineError(true);
        return;
      }
      setServerBase({
        revision: next.revision,
        updatedAt: next.updated_at ?? null,
        contentText: next.content_text ?? null,
      });
    });
  };

  /** Step two: commit the user's copy on the base they just saw. */
  const confirmKeepMine = () => {
    if (!serverBase) return;
    save.conflictResolved(serverBase.revision, doc);
    setConflictOpen(false);
    setServerBase(null);
    // The editor still shows the user's bytes; re-queue them so autosave
    // commits on the base the dialog just showed. A writer landing in between
    // brings the dialog straight back.
    //
    // The ack of that commit is the full server copy: patchDocument parses the
    // response through DocumentSchema (requireVerifiableDocument's fallback is
    // null, never a partial), the machine keeps it in `state.acked`,
    // useDocumentSave writes it into the detail query, and the editor adopts
    // `content` once clean — so what the screen displays after a successful
    // commit is the server's own latest copy (FE design §6.3.2, second
    // clause), not the rejected draft.
    if (lastLocalContentRef.current !== undefined) {
      save.edit({ content: lastLocalContentRef.current });
    }
  };

  const loadServer = () => {
    save.discardDraft();
    setConflictOpen(false);
    void refetch().then((fresh) => {
      const next = fresh.data ?? doc;
      editorRef.current?.adoptContent(next.content, next.revision);
      save.updateBase(next.revision, next);
    });
  };

  const uploader = useCallback<DocumentAssetUploader>(
    async (file, uploadId) => {
      const asset = await uploadAsset.mutateAsync({ file, idempotencyKey: uploadId });
      return { assetId: asset.id, width: asset.width, height: asset.height };
    },
    [uploadAsset],
  );

  const handleAssetError = useCallback(
    (error: unknown) => {
      toast.error(apiErrorMessage(error) ?? t("documents.editor.asset_upload_failed"));
    },
    [t],
  );

  const handleContentError = useCallback(() => {
    toast.error(t("documents.save.error"));
  }, [t]);

  const handleChange = useCallback(
    (content: unknown) => {
      lastLocalContentRef.current = content;
      if (metadataStatusRef.current.pending || bodyQueuedRef.current) {
        queuedBodyRef.current = content;
        bodyQueuedRef.current = true;
        setBodyQueued(true);
        return;
      }
      save.edit({ content });
    },
    [save],
  );

  /** One caption line: the wait, the two failures, or the plain unsaved remark. */
  const leaveCaption = (() => {
    if (leavePending) return t("documents.leave.waiting");
    if (state.phase === "unverifiable") return t("documents.save.unverified");
    if (state.phase === "error" || metadataStatus.failed) return t("documents.save.error");
    return t("documents.save.unsaved");
  })();

  // Breadcrumbs (C-01 §7.1, FE design §4.1): the library, then every ancestor
  // the server proved readable — `document.breadcrumbs` stops at the first
  // ancestor the caller cannot read, and the client invents no link of its
  // own. A Work Product owns its documents: they are not in the library, so
  // their chain starts at the owner page. Until that owner surface (C-14)
  // ships a route, the owner crumb stays a label instead of a guessed URL
  // (FE r1 FE-02), and the back control is not offered to the library either.
  const owned = Boolean(doc.owner_id);
  const ownerCrumbHref = owned && doc.owner_id && ownerHref ? ownerHref(doc.owner_id) : null;
  const ownerCrumb: BreadcrumbSegment[] = owned
    ? [{ href: ownerCrumbHref ?? undefined, label: t("documents.detail.breadcrumb_work_product") }]
    : [];
  const breadcrumbSegments: BreadcrumbSegment[] = owned
    ? ownerCrumb
    : [
        { href: libraryHref, label: t("documents.detail.breadcrumb_library") },
        ...(documentHref
          ? (doc.breadcrumbs ?? [])
              .filter((crumb) => crumb.id)
              .map((crumb) => ({ href: documentHref(crumb.id), label: crumb.title }))
          : []),
      ];
  /** Owner route when there is one; otherwise no back control for owned docs. */
  const backHref = ownerCrumbHref ?? (owned ? null : libraryHref);
  const backLabel = ownerCrumbHref
    ? t("documents.detail.back_to_owner")
    : t("documents.detail.back_to_library");
  const indicatorState = metadataStatus.pending ? { ...state, phase: "saving" as const }
    : !dirty && metadataStatus.failed ? { ...state, phase: "error" as const }
    : !dirty && metadataStatus.dirty ? { ...state, phase: "debouncing" as const, dirty: true }
    : bodyQueued ? { ...state, phase: "debouncing" as const, dirty: true }
    : state;
  const recoveryNotice = doc.kind === "page" && canEdit && (
    pendingUploads > 0 || indicatorState.phase === "error" || indicatorState.phase === "unverifiable" || indicatorState.phase === "conflict"
  );
  const recoveryNoticeLive = indicatorState.phase === "conflict" || indicatorState.phase === "error" || indicatorState.phase === "unverifiable"
    ? "assertive" as const
    : "polite" as const;
  const saveIndicator = (
    <DocumentSaveIndicator
      compact
      state={indicatorState}
      pendingUploads={pendingUploads}
      announce={!recoveryNotice}
      className={recoveryNotice ? "flex-wrap [&>svg]:hidden" : "shrink-0 whitespace-nowrap"}
      onRetry={() => { if (metadataStatus.failed && !dirty) void metadataRef.current?.flush(); else save.retry(); }}
      onResolveConflict={() => setConflictOpen(true)}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        leading={
          backHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={PAGE_LEADING_ICON}
              aria-label={backLabel}
              onClick={() => navigate(backHref)}
            >
              <ArrowLeft aria-hidden className="size-4" />
            </Button>
          ) : undefined
        }
        segments={breadcrumbSegments}
        leaf={
          <span className="truncate font-medium text-foreground">
            {(doc.kind === "page" ? pageTitle : doc.title) || t("documents.detail.untitled")}
          </span>
        }
        actions={
          <>
            {headerActions}
            {doc.kind === "page" && canEdit && !recoveryNotice ? saveIndicator : null}
            {!canEdit ? (
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground"
                title={t("documents.detail.readonly_description")}>
                <Eye aria-hidden className="size-3.5" />
                {t(doc.kind === "page" ? "documents.save.readonly" : "documents.detail.readonly_title")}
              </span>
            ) : null}
            <DocumentCommentsHeaderActions />
          </>
        }
      />

      {!canEdit ? (
        <Notice tone="info" icon={Eye} className={doc.kind === "page" ? "hidden sm:flex" : undefined}>
          {t("documents.detail.readonly_description")}
        </Notice>
      ) : null}
      {recoveryNotice ? (
        <Notice tone="warning" icon={FileWarning} live={recoveryNoticeLive} className="[&>div]:min-w-0">
          {saveIndicator}
        </Notice>
      ) : null}

      <div
        className={
          doc.kind === "page"
            ? `min-h-0 min-w-0 flex-1 overflow-y-auto bg-background pt-12 pb-32 md:pt-16 ${PAGE_GUTTER}`
            : `min-h-0 flex-1 overflow-y-auto py-4 ${PAGE_GUTTER}`
        }
      >
        {doc.kind === "page" ? (
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            <DocumentPageHeader wsId={wsId} doc={doc} editable={canEdit} titleRef={titleRef} metadataRef={metadataRef}
              onTitleChange={setPageTitle} onFocusBody={() => editorRef.current?.focus("start")}
              canPersist={!dirty && state.phase !== "saving" && pendingUploads === 0}
              getRevision={() => stateRef.current.revision}
              onStatusChange={handleMetadataStatus} onSaved={(saved) => save.updateBase(saved.revision, saved)} />
          <Suspense
            fallback={
              <div className="min-h-64 space-y-3" aria-busy>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            }
          >
            <div className="mx-auto w-full max-w-3xl">
              <DocumentEditor
                ref={editorRef}
                wsId={wsId}
                documentId={doc.id}
                initialContent={doc.content}
                content={doc.content}
                contentRevision={doc.revision}
                dirty={dirty}
                editable={canEdit}
                onChange={handleChange}
                onUploadAsset={uploader}
                onAssetError={handleAssetError}
                onPendingUploadsChange={setPendingUploads}
                onContentError={handleContentError}
                onFocusTitle={() => { titleRef.current?.focus(); const input = titleRef.current;
                  if (input) input.setSelectionRange(input.value.length, input.value.length); }}
              />
            </div>
          </Suspense>
          {canEdit ? <Button type="button" variant="ghost" tabIndex={-1}
            className="mt-4 h-32 w-full cursor-text hover:bg-transparent" aria-label={t("documents.page_ui.focus_end")}
            onClick={() => editorRef.current?.focus("end")}><span className="sr-only">{t("documents.page_ui.focus_end")}</span></Button> : null}
          </div>
        ) : (
          <DocumentFileView wsId={wsId} doc={doc} readonly={!canEdit} officeEditorHost={officeEditorHost} />
        )}
      </div>

      <DocumentConflictDialog
        open={conflictOpen}
        onOpenChange={(next) => {
          setConflictOpen(next);
          if (!next) {
            setServerBase(null);
            setKeepMineError(false);
          }
        }}
        mineRevision={state.revision}
        serverRevision={String(state.errorFields?.current_revision ?? doc.revision)}
        serverBase={serverBase}
        pending={state.phase === "saving"}
        keepMinePending={keepMinePending}
        keepMineError={keepMineError}
        onKeepMine={keepMine}
        onConfirmKeepMine={confirmKeepMine}
        onBackFromServerBase={() => setServerBase(null)}
        onLoadServer={loadServer}
      />

      <Dialog open={leaveOpen} onOpenChange={(next) => (!next && !leavePending ? finishLeave(false) : undefined)}>
        <DialogContent className="sm:max-w-md" showCloseButton={!leavePending} closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("documents.leave.title")}</DialogTitle>
            <DialogDescription>{t("documents.leave.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <FileWarning aria-hidden className="size-4" />
            {leaveCaption}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={leavePending} onClick={() => finishLeave(false)}>
              {t("documents.leave.stay")}
            </Button>
            <Button type="button" variant="ghost" disabled={leavePending} onClick={() => finishLeave(true)}>
              {t("documents.leave.discard")}
            </Button>
            <Button type="button" disabled={leavePending} aria-busy={leavePending || undefined} onClick={saveThenLeave}>
              {leavePending ? t("documents.leave.waiting") : t("documents.leave.save_and_leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
