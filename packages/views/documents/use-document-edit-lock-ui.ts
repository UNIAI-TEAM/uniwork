"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { useDocumentEditLock } from "@uniwork/core/documents/hooks-edit-lock";
import { useDocumentSave } from "@uniwork/core/documents/hooks";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import type { Document } from "@uniwork/core/types/document";
import { useNavigation } from "../navigation";
import type { FrameEditLock } from "../office/frame/frame-edit-lock";
import type { DocumentEditorHandle } from "./document-editor";
import { downloadPageCopy } from "./edit-lock-copy";
import { useExpiryTick } from "./use-expiry-tick";
import { onWriteRefused } from "./edit-lock-refusal";
import { editLockBannerView, editLockHeaderHolder } from "./edit-lock-view-model";

/**
 * The lost-lock reason a 423 on a write implies (addendum §11.1, rule 2):
 * the same user elsewhere moved it here, anyone else took it over.
 */
function lostFrom423(fields: Record<string, unknown> | undefined): { reason: string; by: { id: string; name: string } | null } {
  if (fields?.held_by_me === true) return { reason: "moved_here", by: null };
  const id = typeof fields?.holder_id === "string" ? fields.holder_id : "";
  const name = typeof fields?.holder_name === "string" ? fields.holder_name : "";
  return { reason: "taken_over", by: id ? { id, name } : null };
}

/** A save that ended without landing: nothing is handed over. */
const FAILED_SAVE = new Set(["error", "unverifiable", "conflict", "locked"]);

export interface UseDocumentEditLockUiOptions {
  wsId: string;
  doc: Document;
  /** my_level is edit or manage. */
  canEdit: boolean;
  /** The editor that takes the lock is on screen: the page, or the mounted Office frame. */
  active: boolean;
  /** Bytes the server has not acknowledged (the page's own definition, uploads included). */
  hasUnsavedWork: () => boolean;
  refetch: () => Promise<{ data?: Document | null; isError?: boolean }>;
  editorRef: RefObject<DocumentEditorHandle | null>;
  /** The title the page shows now (the downloaded copy is named after it). */
  title: string;
}

/**
 * The document page's side of the edit lock (UNI-1645, addendum §9, §11.3):
 * the lock and the save machine together (every gated write carries the held
 * id; a 423 ends the hold; holding it again restarts autosave), and the state
 * the banner, the take-over dialog, the lost dialog, the holder's request
 * prompt and the Office frame read.
 */
export function useDocumentEditLockUi({ wsId, doc, canEdit, active, hasUnsavedWork, refetch, editorRef, title }: UseDocumentEditLockUiOptions) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { searchParams } = useNavigation();
  const page = doc.kind === "page";
  const baseRef = useRef(doc.revision);
  // After an expiry while away: take the lock back only if the server is still at the editor's base.
  const canReclaim = useCallback(async () => {
    const fresh = await refetch();
    return !fresh.isError && fresh.data?.revision === baseRef.current;
  }, [refetch]);
  const lock = useDocumentEditLock(wsId, doc.id, { canEdit: canEdit && active, client: page ? "web_page" : "web_office", canReclaim });
  const save = useDocumentSave(wsId, doc.id, doc.revision, { editLockId: lock.editLockId });
  const saveState = save.state as DocumentSaveState;
  baseRef.current = saveState.revision;
  const { phase, lostReason, lostBy } = lock.state;
  const r1 = lock.lockState.data;

  // A gated write answered 423 while this editor held the lock: end the hold like any lost lock.
  // Only a refusal of the lock id held NOW counts, and each refusal once: a late 423 for an older
  // id (or one already handled) must not drop a lock that was regained since (CFE-1-1). A refusal is
  // told apart by the send it answers, not by its fields, which a 423 may not carry (CFE-2-1).
  // The save machine is per document and counts sends from 0, so the handled seq belongs to the
  // document it was seen on: a component that stays mounted across a document switch starts over
  // (CFE-3-1), or the new document's refusal at the same seq would be swallowed.
  const handled423 = useRef({ scope: "", seq: 0 });
  useEffect(() => {
    const scope = `${wsId}/${doc.id}`;
    if (handled423.current.scope !== scope) handled423.current = { scope, seq: 0 };
    if (saveState.phase !== "locked" || phase !== "mine") return;
    if (handled423.current.seq === saveState.sendSeq) return;
    if (saveState.sentEditLockId !== lock.editLockId) return;
    handled423.current.seq = saveState.sendSeq;
    const lost = lostFrom423(saveState.errorFields);
    lock.markLost(lost.reason, lost.by);
  }, [wsId, doc.id, saveState.phase, saveState.errorFields, saveState.sendSeq, saveState.sentEditLockId, phase, lock]);
  // Holding it again (edit now, edit here, a handover): the kept draft goes out after the quiet window.
  // Only on the way into "mine", or for a refusal of an older id; a refusal of the current id is the
  // effect above's to end the hold with.
  const restorePhase = useRef(phase);
  useEffect(() => {
    const was = restorePhase.current;
    restorePhase.current = phase;
    if (phase !== "mine" || saveState.phase !== "locked") return;
    if (was !== "mine" || saveState.sentEditLockId !== lock.editLockId) save.lockRestored();
  }, [phase, saveState.phase, saveState.sentEditLockId, lock.editLockId, save]);

  // A restore or a new file version sent from outside the editor was refused 423 (CFE-1-12): the
  // same ending, for the lock id it carried only (a write of an older tenure says nothing about now).
  const heldId = useRef(lock.editLockId);
  heldId.current = lock.editLockId;
  const markLostRef = useRef(lock.markLost);
  markLostRef.current = lock.markLost;
  useEffect(
    () =>
      onWriteRefused(doc.id, (fields, sentLockId) => {
        if (sentLockId !== undefined && sentLockId !== heldId.current) return;
        const lost = lostFrom423(fields);
        markLostRef.current(lost.reason, lost.by);
      }),
    [doc.id],
  );

  /* ---- read-only -> mine: start from the server's current revision (addendum §9) ---- */
  // A content-only save emits no document.updated, so a read-only copy can be
  // any number of saves behind the holder's. Whenever this editor comes to
  // hold the lock after being read-only (a handover, a take-over, edit here,
  // unheld -> mine), it rereads the document and adopts it before it turns
  // editable. A kept draft is the user's and goes the lockRestored path instead.
  const wasReadOnly = useRef(false);
  const catchUpOp = useRef(0);
  const [catchingUp, setCatchingUp] = useState(false);
  const latest = useRef({ save, refetch, hasUnsavedWork, page });
  latest.current = { save, refetch, hasUnsavedWork, page };
  useEffect(() => {
    if (phase === "other" || phase === "lost" || phase === "released") {
      wasReadOnly.current = true;
      return;
    }
    if (phase !== "mine" || !wasReadOnly.current) return;
    wasReadOnly.current = false;
    const now = latest.current;
    if (!now.page || now.hasUnsavedWork()) return;
    const op = ++catchUpOp.current;
    setCatchingUp(true);
    void now.refetch().then(
      (fresh) => {
        if (op !== catchUpOp.current) return;
        const current = latest.current;
        if (fresh.data && !fresh.isError && fresh.data.revision !== baseRef.current && !current.hasUnsavedWork()) {
          editorRef.current?.adoptContent(fresh.data.content, fresh.data.revision);
          current.save.updateBase(fresh.data.revision, fresh.data);
        }
        setCatchingUp(false);
      },
      () => {
        if (op === catchUpOp.current) setCatchingUp(false);
      },
    );
  }, [phase, editorRef]);

  /* ---- lost with unsaved changes: the dialog (page only; the frame keeps its drafts) ---- */
  const [lostOpen, setLostOpen] = useState(false);
  const prevPhase = useRef(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase !== "lost" || was === "lost") return;
    if (page && lostReason !== "session_revoked" && hasUnsavedWork()) setLostOpen(true);
  }, [phase, lostReason, page, hasUnsavedWork]);

  const loadLatest = useCallback(async () => {
    // Reread first: a failed reread must neither drop the draft nor pass stale cache off as the newest.
    const fresh = await refetch().catch(() => null);
    if (!fresh || fresh.isError || !fresh.data) {
      toast.error(t("documents.editLock.reloadFailed"));
      return;
    }
    save.discardDraft();
    editorRef.current?.adoptContent(fresh.data.content, fresh.data.revision);
    save.updateBase(fresh.data.revision, fresh.data);
  }, [save, refetch, editorRef, t]);

  const lostDialog = {
    open: lostOpen,
    onOpenChange: setLostOpen,
    reason: lostReason,
    byName: lostBy?.name ?? "",
    onDownload: () => {
      const name = title || t("documents.detail.untitled");
      downloadPageCopy(editorRef.current?.getHTML() ?? "", name, t("documents.editLock.myCopyName", { title: name }));
      setLostOpen(false);
    },
    onReload: () => {
      setLostOpen(false);
      void loadLatest();
    },
  };

  /* ---- the request this user sent: declined/expired, rate limit; a handover lands here ---- */
  const [notReleased, setNotReleased] = useState(false);
  const [rateLimitedMinutes, setRateLimitedMinutes] = useState<number | null>(null);
  const sentRequest = useRef<string | null>(null);
  const lastHolder = useRef("");
  useEffect(() => {
    if (!r1) return;
    if (r1.lock && !r1.lock.held_by_me) lastHolder.current = r1.lock.holder_name;
    if (r1.my_request?.status === "pending") {
      sentRequest.current = r1.my_request.request_id;
      setNotReleased(false);
      return;
    }
    // The pending request is gone while someone else still holds it: declined, or it ran out.
    if (sentRequest.current && r1.lock && !r1.lock.held_by_me) setNotReleased(true);
    if (!r1.lock || r1.lock.held_by_me) setNotReleased(false);
    sentRequest.current = null;
  }, [r1]);
  useEffect(() => {
    if (rateLimitedMinutes === null) return;
    const timer = setTimeout(() => setRateLimitedMinutes(null), rateLimitedMinutes * 60_000);
    return () => clearTimeout(timer);
  }, [rateLimitedMinutes]);
  const grantedVia = lock.state.lock?.granted_via;
  useEffect(() => {
    if (phase === "mine" && grantedVia === "handover") {
      toast.success(t("documents.editLock.handedToYou", { name: lastHolder.current || t("documents.editLock.lostSomeone") }));
    }
  }, [phase, grantedVia, t]);

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: documentKeys.editLock(wsId, doc.id) }), [qc, wsId, doc.id]);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work().finally(() => setBusy(false));
  };
  const onRequest = () =>
    run(() =>
      lock.requestEdit.mutateAsync().catch((err: unknown) => {
        if (err instanceof ApiError && err.code === "edit_request_rate_limited") {
          const seconds = Number(err.fields?.retry_after_s);
          setRateLimitedMinutes(Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 60) / 60)));
        } else if (!(err instanceof ApiError && err.code === "edit_lock_free")) {
          toast.error(t("documents.editLock.requestFailed"));
        }
      }),
    );
  const onCancelRequest = (requestId: string) => {
    sentRequest.current = null;
    run(() => lock.cancelRequest.mutateAsync(requestId).catch(() => toast.error(t("documents.editLock.requestFailed"))));
  };
  // "Edit now": a newer server copy is loaded before the editor turns editable (addendum §9).
  const onEditNow = () =>
    run(async () => {
      if (page && !hasUnsavedWork()) {
        const fresh = await refetch();
        if (fresh.data && !fresh.isError && fresh.data.revision !== saveState.revision) {
          editorRef.current?.adoptContent(fresh.data.content, fresh.data.revision);
          save.updateBase(fresh.data.revision, fresh.data);
        }
        // Already caught up: the grant need not reread again.
        if (fresh.data && !fresh.isError) wasReadOnly.current = false;
      }
      await lock.acquire();
    });
  const onEditHere = () => run(() => lock.moveHere());

  const [takeOverOpen, setTakeOverOpen] = useState(false);
  const takeOverDialog = {
    open: takeOverOpen,
    onOpenChange: setTakeOverOpen,
    lock: r1?.lock ?? null,
    onConfirm: (expected: string) => lock.takeOver.mutateAsync(expected),
    onReread: () => void invalidate(),
  };

  /* ---- a request to this holder: the prompt, opened again by ?edit_request=<id> ---- */
  const linked = searchParams.get("edit_request");
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (linked) setDismissed((now) => (now.has(linked) ? new Set([...now].filter((id) => id !== linked)) : now));
  }, [linked]);
  const incoming = phase === "mine"
    ? (r1?.pending_requests ?? []).filter((req) => req.status === "pending" && !(Date.parse(req.expires_at) <= Date.now()) && !dismissed.has(req.request_id))
    : [];
  const request = incoming.find((req) => req.request_id === linked) ?? incoming[0] ?? null;
  // A request that ran out (the one I sent, one sent to me) stops being answerable on time.
  useExpiryTick([r1?.my_request?.status === "pending" ? r1.my_request.expires_at : null, ...(r1?.pending_requests ?? []).map((req) => req.expires_at)]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const answer = useCallback(
    (requestId: string, decision: "accept" | "decline") =>
      lock.answerRequest.mutateAsync({ requestId, decision }).then(
        () => setDismissed((now) => new Set(now).add(requestId)),
        () => toast.error(t("documents.editLock.requestFailed")),
      ),
    [lock.answerRequest, t],
  );
  // "Save and hand over": hand over only once the save landed; a failed save hands nothing over.
  useEffect(() => {
    if (!accepting) return;
    if (FAILED_SAVE.has(saveState.phase)) {
      setAccepting(null);
      setSaveFailed(true);
      return;
    }
    if (saveState.phase === "saving" || saveState.phase === "debouncing" || (page && hasUnsavedWork())) return;
    const requestId = accepting;
    setAccepting(null);
    void answer(requestId, "accept");
  }, [accepting, saveState.phase, page, hasUnsavedWork, answer]);
  const prompt = request
    ? {
        requesterName: request.requester_name,
        pending: accepting !== null || lock.answerRequest.isPending,
        saveFailed,
        focusOnMount: request.request_id === linked,
        onAccept: () => {
          setSaveFailed(false);
          // A frame saves through its own Save; the page only flushes its own editor.
          if (page && hasUnsavedWork()) save.flush();
          setAccepting(request.request_id);
        },
        onDecline: () => void answer(request.request_id, "decline"),
        onDismiss: () => setDismissed((now) => new Set(now).add(request.request_id)),
      }
    : null;

  const markLost = lock.markLost;
  const frameEditLock = useMemo<FrameEditLock>(
    () => ({
      held: phase === "mine",
      lockId: lock.editLockId,
      onLocked: (fields) => {
        const lost = lostFrom423(fields);
        markLost(lost.reason, lost.by);
      },
    }),
    [phase, lock.editLockId, markLost],
  );

  return {
    save,
    /** Only the holder may type; acquiring and the catch-up reread block input without saying "read-only" (§9 FE-8). */
    editable: canEdit && phase === "mine" && !catchingUp,
    acquiringSlow: phase === "acquiring" && lock.state.slow,
    /** Someone else (or this user in another window, state 4) holds it: the header names them. */
    holder: editLockHeaderHolder(lock.state, r1),
    banner: {
      view: editLockBannerView({ session: lock.state, lockState: r1, showLost: !page, notReleased, rateLimitedMinutes }),
      pending: busy,
      onTakeOver: () => setTakeOverOpen(true),
      onRequest,
      onCancelRequest,
      onEditHere,
      onEditNow,
    },
    takeOverDialog,
    lostDialog,
    prompt,
    frameEditLock,
  };
}
