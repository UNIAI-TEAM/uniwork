"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acquireDocumentEditLock,
  answerDocumentEditRequest,
  cancelDocumentEditRequest,
  createDocumentEditRequest,
  getDocumentEditLock,
  heartbeatDocumentEditLock,
  releaseDocumentEditLock,
  takeOverDocumentEditLock,
  type DocumentEditLockClient,
} from "../api/endpoints/documents-edit-lock";
import { EditLockSession, type EditLockSessionState } from "./edit-lock-session";
import { documentKeys } from "./keys";

// UNI-1645 (addendum §9): one EditLockSession per open editor that may edit,
// plus the R1 state as a query and the request / take-over actions as
// mutations. Realtime lock frames invalidate `documentKeys.editLock`; the
// session itself is never cached.

const IDLE: EditLockSessionState = {
  phase: "idle",
  lock: null,
  holder: null,
  lostReason: null,
  lostBy: null,
  baseChanged: false,
  errorCode: null,
  slow: false,
  editable: false,
  readOnly: false,
};

const noopSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE;

export interface UseDocumentEditLockOptions {
  /** my_level is edit or manage; below that no lock is requested at all. */
  canEdit: boolean;
  client: DocumentEditLockClient;
  /** After an expiry while away: true when the server's revision is still
   *  the editor's base, so the lock may be taken back without a conflict. */
  canReclaim?: () => boolean | Promise<boolean>;
}

/** The R1 state of one document's edit lock (who holds it, requests). */
export function useDocumentEditLockState(wsId: string, documentId: string) {
  return useQuery({
    queryKey: documentKeys.editLock(wsId, documentId),
    queryFn: ({ signal }) => getDocumentEditLock(documentId, signal),
    enabled: !!wsId && !!documentId,
  });
}

export function useDocumentEditLock(wsId: string, documentId: string, opts: UseDocumentEditLockOptions) {
  const qc = useQueryClient();
  const { canEdit, client } = opts;
  const lockState = useDocumentEditLockState(wsId, documentId);
  const canReclaim = useRef(opts.canReclaim);
  useEffect(() => {
    canReclaim.current = opts.canReclaim;
  }, [opts.canReclaim]);

  const [session, setSession] = useState<EditLockSession | null>(null);
  useEffect(() => {
    if (!canEdit || !documentId) return;
    // A fresh session per effect run: StrictMode's mount → cleanup → mount
    // must not reuse a disposed one.
    const next = new EditLockSession({
      documentId,
      client,
      transport: {
        acquire: (body) => acquireDocumentEditLock(documentId, body),
        heartbeat: (lockId) => heartbeatDocumentEditLock(documentId, lockId),
        release: (lockId, releaseOpts) => releaseDocumentEditLock(documentId, lockId, releaseOpts),
      },
      canReclaim: () => canReclaim.current?.() ?? true,
    });
    setSession(next);
    next.start();
    // Closing the page releases with keepalive; the TTL covers a crash.
    const onPageHide = () => void next.release({ keepalive: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void next.release();
      next.dispose();
      setSession(null);
    };
  }, [canEdit, client, documentId]);

  const [subscribe, getSnapshot] = useMemo(
    () => (session ? [session.subscribe.bind(session), session.getState.bind(session)] : [noopSubscribe, idleSnapshot]),
    [session],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // Every hold change here is a change the R1 state shows.
  useEffect(() => {
    if (state.phase === "idle" || state.phase === "acquiring") return;
    void qc.invalidateQueries({ queryKey: documentKeys.editLock(wsId, documentId) });
  }, [qc, wsId, documentId, state.phase]);

  // A lock frame refetched R1: if it no longer shows this user holding, ask
  // the server now instead of at the next beat; if a handover was reserved
  // for this user, claim it (R2 answers 200).
  const summary = lockState.data?.lock;
  useEffect(() => {
    if (!session || lockState.data === undefined) return;
    const phase = session.getState().phase;
    if (phase === "mine" && !summary?.held_by_me) session.wake();
    else if (phase === "other" && summary?.reserved && summary.held_by_me) void session.acquire();
  }, [session, lockState.data, summary]);

  const invalidate = () => qc.invalidateQueries({ queryKey: documentKeys.editLock(wsId, documentId) });

  const takeOver = useMutation({
    // C2-1: expected_lock_id is the R1 lock_id a manager reads when the
    // confirm dialog opens; a stale one answers 409 edit_lock_changed.
    mutationFn: async (expectedLockId?: string) => {
      const expected = expectedLockId ?? lockState.data?.lock?.lock_id;
      if (!session || !expected) throw new Error("edit_lock_take_over_unavailable");
      const lock = await takeOverDocumentEditLock(documentId, {
        editor_id: session.editorId,
        client,
        expected_lock_id: expected,
      });
      if (!lock) throw new Error("edit_lock_not_verifiable");
      session.adopt(lock);
      return lock;
    },
    onSettled: invalidate,
  });
  const requestEdit = useMutation({
    mutationFn: () => createDocumentEditRequest(documentId),
    onSettled: invalidate,
  });
  const cancelRequest = useMutation({
    mutationFn: (requestId: string) => cancelDocumentEditRequest(documentId, requestId),
    onSettled: invalidate,
  });
  const answerRequest = useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: "accept" | "decline" }) => {
      const lockId = session?.getState().lock?.lock_id;
      if (!lockId) throw new Error("edit_lock_not_held");
      return answerDocumentEditRequest(documentId, requestId, { decision, lock_id: lockId });
    },
    onSettled: invalidate,
  });

  return useMemo(
    () => ({
      state,
      /** The R1 query: holder summary, my_request, pending_requests. */
      lockState,
      /** Goes on every gated write while this editor holds the lock. */
      editLockId: state.phase === "mine" ? state.lock?.lock_id : undefined,
      /** "Edit now" once the lock came free. */
      acquire: () => session?.acquire() ?? Promise.resolve(),
      /** "Edit here": move this user's lock from another tab or device. */
      moveHere: () => session?.moveHere() ?? Promise.resolve(),
      release: (releaseOpts?: { keepalive?: boolean }) => session?.release(releaseOpts) ?? Promise.resolve(),
      /** A gated write answered 423 while "mine": end the hold (lost dialog, read-only). */
      markLost: (reason: string, by?: { id: string; name: string } | null) => session?.markLost(reason, by ?? null),
      takeOver,
      requestEdit,
      cancelRequest,
      answerRequest,
    }),
    [state, lockState, session, takeOver, requestEdit, cancelRequest, answerRequest],
  );
}
