"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { PAGE_GUTTER, PAGE_LEADING_ICON } from "../layout/page-header";
import { Notice } from "../common/notice";
import { leaveGuardAllows, registerLeaveGuard, useNavigation } from "../navigation";
import type { DocumentAssetUploader } from "./document-asset-upload";
import { DocumentConflictDialog } from "./conflict-dialog";
import type { DocumentEditorHandle } from "./document-editor";
import { DocumentFileView } from "./document-file-view";
import { DocumentSaveIndicator } from "./document-save-indicator";

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
  /** Re-read the document from the server (conflict resolution). */
  refetch: () => Promise<{ data?: Document | null }>;
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
export function DocumentWorkspace({ wsId, doc, libraryHref, refetch }: DocumentWorkspaceProps) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const save = useDocumentSave(wsId, doc.id, doc.revision);
  const uploadAsset = useUploadDocumentAsset(wsId, doc.id);
  const state = save.state as DocumentSaveState;

  const canEdit = doc.my_level === "edit" || doc.my_level === "manage";
  const editorRef = useRef<DocumentEditorHandle>(null);
  const lastLocalContentRef = useRef<unknown>(undefined);
  const stateRef = useRef(state);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const leaveResolveRef = useRef<((allowed: boolean) => void) | null>(null);
  const leaveSettleRef = useRef<((phase: string) => void) | null>(null);
  const leaveDoneRef = useRef(false);

  stateRef.current = state;
  const dirty = state.dirty;

  // The machine stops on a stale base; the dialog is the only way forward.
  useEffect(() => {
    if (state.phase === "conflict") setConflictOpen(true);
  }, [state.phase]);

  // Another writer (or a refetch) moved the base while we were clean: adopt it.
  useEffect(() => {
    if (!dirty) save.updateBase(doc.revision, doc);
    // `save` is rebuilt on every state change on purpose: updateBase is a no-op
    // unless the machine is clean, and a stale closure here would miss a base.
  }, [doc.revision, doc, dirty, save]);

  /* ---- leaving with unsaved changes (C-01 §7.3, FE design §5.4) ---- */

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      // Best effort and a warning only: the 2 MiB page JSON cannot be promised
      // over a keepalive body, so the guard is the in-app dialog, not this.
      if (!stateRef.current.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(
    () =>
      registerLeaveGuard(() => {
        if (!stateRef.current.dirty) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          leaveResolveRef.current = resolve;
          leaveDoneRef.current = false;
          setLeaveOpen(true);
        });
      }),
    [],
  );

  useEffect(() => {
    const settle = leaveSettleRef.current;
    if (!settle) return;
    if (state.phase === "saving" || state.phase === "debouncing") return;
    leaveSettleRef.current = null;
    settle(state.phase);
  }, [state.phase]);

  const finishLeave = useCallback((allowed: boolean) => {
    const resolve = leaveResolveRef.current;
    leaveResolveRef.current = null;
    leaveSettleRef.current = null;
    setLeaveOpen(false);
    setLeavePending(false);
    resolve?.(allowed);
  }, []);

  const afterSaveAttempt = useCallback(
    (phase: string) => {
      if (leaveDoneRef.current) return;
      leaveDoneRef.current = true;
      if (phase === "saved") {
        finishLeave(true);
        return;
      }
      setLeavePending(false);
      if (phase === "conflict") setConflictOpen(true);
    },
    [finishLeave],
  );

  const saveThenLeave = () => {
    setLeavePending(true);
    leaveDoneRef.current = false;
    const settled = new Promise<string>((resolve) => {
      leaveSettleRef.current = resolve;
    });
    save.flush();
    queueMicrotask(() => {
      const phase = stateRef.current.phase;
      if (phase !== "saving" && phase !== "debouncing") {
        leaveSettleRef.current = null;
        afterSaveAttempt(phase);
      }
    });
    void settled.then(afterSaveAttempt);
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

  const keepMine = () => {
    const serverRevision = String(state.errorFields?.current_revision ?? doc.revision);
    save.conflictResolved(serverRevision, doc);
    setConflictOpen(false);
    // The editor still shows the user's bytes; re-queue them so autosave
    // commits on the base the dialog just showed. A writer landing in between
    // brings the dialog straight back.
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
      save.edit({ content });
    },
    [save],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        leading={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={PAGE_LEADING_ICON}
            aria-label={t("documents.detail.back_to_library")}
            onClick={() => navigate(libraryHref)}
          >
            <ArrowLeft aria-hidden className="size-4" />
          </Button>
        }
        segments={[{ href: libraryHref, label: t("documents.detail.breadcrumb_library") }]}
        leaf={
          <span className="truncate font-medium text-foreground">
            {doc.title || t("documents.detail.untitled")}
          </span>
        }
        actions={
          <>
            {doc.kind === "page" ? (
              <DocumentSaveIndicator
                state={state}
                pendingUploads={pendingUploads}
                readonly={!canEdit}
                onRetry={save.retry}
                onResolveConflict={() => setConflictOpen(true)}
              />
            ) : null}
            {!canEdit ? (
              <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <Eye aria-hidden className="size-3.5" />
                {t("documents.detail.readonly_title")}
              </span>
            ) : null}
          </>
        }
      />

      {!canEdit ? (
        <Notice tone="info" icon={Eye}>
          {t("documents.detail.readonly_description")}
        </Notice>
      ) : null}

      <div
        className={
          doc.kind === "page"
            ? "min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10 sm:py-8"
            : `min-h-0 flex-1 overflow-y-auto py-4 ${PAGE_GUTTER}`
        }
      >
        {doc.kind === "page" ? (
          <Suspense
            fallback={
              <div className="mx-auto w-full max-w-3xl space-y-3" aria-busy>
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-40 w-full" />
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
              />
            </div>
          </Suspense>
        ) : (
          <DocumentFileView wsId={wsId} doc={doc} readonly={!canEdit} />
        )}
      </div>

      <DocumentConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        mineRevision={state.revision}
        serverRevision={String(state.errorFields?.current_revision ?? doc.revision)}
        pending={state.phase === "saving"}
        onKeepMine={keepMine}
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
            {leavePending ? t("documents.leave.waiting") : t("documents.save.unsaved")}
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
