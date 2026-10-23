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
  type DocumentEditLockSummary,
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

/** Slack after the server's deadline before R1 is read again. */
const REREAD_GRACE_MS = 2000;
/** Already past the deadline yet still reported held (sweeper not run): wait before the next read. */
const REREAD_RETRY_MS = 5000;
/** setTimeout overflows past 2^31 - 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The later of expires_at and offline_hold_until of someone else's lock. */
function otherHolderDeadline(lock: DocumentEditLockSummary | null | undefined): string | null {
  if (!lock || lock.held_by_me) return null;
  const expires = Date.parse(lock.expires_at);
  const hold = lock.offline_hold_until ? Date.parse(lock.offline_hold_until) : Number.NaN;
  if (Number.isNaN(expires)) return Number.isNaN(hold) ? null : (lock.offline_hold_until ?? null);
  return !Number.isNaN(hold) && hold > expires ? (lock.offline_hold_until ?? null) : lock.expires_at;
}

/** Time left from the server's own clock (deadline - server_time) plus grace; the
 *  timer itself runs on the local monotonic clock. Null when a time is unreadable. */
function rereadDelayMs(deadline: string, serverTime: string): number | null {
  const left = Date.parse(deadline) - Date.parse(serverTime);
  if (Number.isNaN(left)) return null;
  return Math.min(left <= 0 ? REREAD_RETRY_MS : left + REREAD_GRACE_MS, MAX_TIMER_MS);
}

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
  // Bumped by a bfcache restore: the effect below runs again and starts a fresh session.
  const [restore, setRestore] = useState(0);
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
    // pagehide released the lock; a page restored from the back/forward cache is
    // the same document with a dead session, so it acquires again (CFE-1-3).
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRestore((n) => n + 1);
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      void next.release();
      next.dispose();
      setSession(null);
    };
  }, [canEdit, client, documentId, restore]);

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

  // Another holder's lease: reread R1 once when it runs out, so a dead tab's
  // lock reaches this user without waiting for the sweeper's frame. One timer,
  // re-armed by every R1 read (dataUpdatedAt), cleared on unmount / phase change.
  const serverTime = lockState.data?.server_time;
  const otherUntil = otherHolderDeadline(summary);
  const readAt = lockState.dataUpdatedAt;
  const otherPhase = state.phase === "other";
  useEffect(() => {
    if (!otherPhase || !otherUntil || !serverTime) return;
    const delay = rereadDelayMs(otherUntil, serverTime);
    if (delay === null) return;
    const timer = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: documentKeys.editLock(wsId, documentId) });
    }, delay);
    return () => clearTimeout(timer);
  }, [qc, wsId, documentId, otherPhase, otherUntil, serverTime, readAt]);

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
      if (!session.adopt(lock)) {
        // The editor closed while the take-over flew: do not leave the lock held.
        void releaseDocumentEditLock(documentId, lock.lock_id, { keepalive: true }).catch(() => undefined);
        throw new Error("edit_lock_session_closed");
      }
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
