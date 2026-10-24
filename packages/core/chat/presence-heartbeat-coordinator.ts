import { signalChatPresence } from "../api/endpoints/chat";
import { beatPresence } from "./presence-beat-transport";
import { isHostFocused } from "../platform/host-focus";

/**
 * Client beat interval while the tab is visible. Must stay well under server
 * presence TTL (90s); a backgrounded Chrome tab may wake timers only once a minute.
 */
export const CHAT_PRESENCE_HEARTBEAT_MS = 30_000;
const HIDDEN_HEARTBEAT_MS = 60_000;
/** One beat per visible interval window; blocks dev remount / Strict Mode bursts. */
const MIN_BEAT_GAP_MS = 28_000;
/** A beat this recent means unmount was a remount, not leaving the workspace. */
const LEAVE_SKIP_IF_BEAT_WITHIN_MS = 4_000;

type SnapshotHandler = (online: string[] | null, sentAt: number) => void;

interface WorkspaceHeartbeat {
  refs: number;
  timer: number | undefined;
  handlers: Set<SnapshotHandler>;
}

const workspaces = new Map<string, WorkspaceHeartbeat>();
const pendingLeaveTimers = new Map<string, number>();
const lastBeatAt = new Map<string, number>();
const beatsInFlight = new Set<string>();
/** Absorb React Strict Mode remounts without offline → online flapping. */
const PRESENCE_LEAVE_DEBOUNCE_MS = 250;
let pagehideListener: (() => void) | undefined;
let visibilityListener: (() => void) | undefined;

function heartbeatPeriodMs(): number {
  if (typeof document === "undefined") return CHAT_PRESENCE_HEARTBEAT_MS;
  return document.visibilityState === "visible" ? CHAT_PRESENCE_HEARTBEAT_MS : HIDDEN_HEARTBEAT_MS;
}

function leavePresence(workspaceId: string, opts?: { keepalive?: boolean }): void {
  void signalChatPresence(workspaceId, "offline", opts).catch(() => undefined);
}

function cancelScheduledLeave(workspaceId: string): void {
  const timer = pendingLeaveTimers.get(workspaceId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  pendingLeaveTimers.delete(workspaceId);
}

function scheduleLeave(workspaceId: string): void {
  if (Date.now() - (lastBeatAt.get(workspaceId) ?? 0) < LEAVE_SKIP_IF_BEAT_WITHIN_MS) {
    return;
  }
  cancelScheduledLeave(workspaceId);
  pendingLeaveTimers.set(
    workspaceId,
    window.setTimeout(() => {
      pendingLeaveTimers.delete(workspaceId);
      leavePresence(workspaceId);
    }, PRESENCE_LEAVE_DEBOUNCE_MS),
  );
}

function mayBeatNow(workspaceId: string): boolean {
  if (beatsInFlight.has(workspaceId)) return false;
  return Date.now() - (lastBeatAt.get(workspaceId) ?? 0) >= MIN_BEAT_GAP_MS;
}

function runBeat(workspaceId: string): void {
  const state = workspaces.get(workspaceId);
  if (!state || !mayBeatNow(workspaceId)) return;

  beatsInFlight.add(workspaceId);
  lastBeatAt.set(workspaceId, Date.now());
  const sentAt = Date.now();
  void beatPresence(workspaceId, isHostFocused())
    .then((online) => {
      const current = workspaces.get(workspaceId);
      if (!current) return;
      for (const handler of current.handlers) {
        handler(online, sentAt);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      beatsInFlight.delete(workspaceId);
    });
}

function restartWorkspaceTimer(workspaceId: string): void {
  const state = workspaces.get(workspaceId);
  if (!state?.timer) return;
  window.clearInterval(state.timer);
  state.timer = window.setInterval(() => {
    runBeat(workspaceId);
  }, heartbeatPeriodMs());
}

function restartAllTimers(): void {
  for (const workspaceId of workspaces.keys()) {
    restartWorkspaceTimer(workspaceId);
  }
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    for (const workspaceId of workspaces.keys()) {
      runBeat(workspaceId);
    }
  }
}

function ensureVisibilityListener(): void {
  if (visibilityListener || typeof document === "undefined") return;
  const onVisibility = () => {
    restartAllTimers();
  };
  document.addEventListener("visibilitychange", onVisibility);
  visibilityListener = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    visibilityListener = undefined;
  };
}

function ensurePageHideListener(): void {
  if (pagehideListener) return;
  const onPageHide = () => {
    for (const timer of pendingLeaveTimers.values()) {
      window.clearTimeout(timer);
    }
    pendingLeaveTimers.clear();
    for (const workspaceId of workspaces.keys()) {
      leavePresence(workspaceId, { keepalive: true });
    }
  };
  window.addEventListener("pagehide", onPageHide);
  pagehideListener = () => {
    window.removeEventListener("pagehide", onPageHide);
    pagehideListener = undefined;
  };
}

/** One shared heartbeat per workspace; refcounted by shell subscribers. */
export function acquirePresenceHeartbeat(
  workspaceId: string,
  onSnapshot: SnapshotHandler,
): () => void {
  let state = workspaces.get(workspaceId);
  if (!state) {
    state = { refs: 0, timer: undefined, handlers: new Set() };
    workspaces.set(workspaceId, state);
  }
  state.handlers.add(onSnapshot);
  const starting = state.refs === 0;
  state.refs += 1;

  if (starting) {
    cancelScheduledLeave(workspaceId);
    runBeat(workspaceId);
    state.timer = window.setInterval(() => {
      runBeat(workspaceId);
    }, heartbeatPeriodMs());
    ensurePageHideListener();
    ensureVisibilityListener();
  }

  return () => {
    const current = workspaces.get(workspaceId);
    if (!current) return;
    current.handlers.delete(onSnapshot);
    current.refs -= 1;
    if (current.refs > 0) return;
    if (current.timer) window.clearInterval(current.timer);
    workspaces.delete(workspaceId);
    scheduleLeave(workspaceId);
    if (workspaces.size === 0) {
      pagehideListener?.();
      visibilityListener?.();
    }
  };
}

/** Reset coordinator state between tests. */
export function resetPresenceHeartbeatCoordinatorForTests(): void {
  for (const timer of pendingLeaveTimers.values()) {
    window.clearTimeout(timer);
  }
  pendingLeaveTimers.clear();
  lastBeatAt.clear();
  beatsInFlight.clear();
  for (const [workspaceId, state] of workspaces) {
    if (state.timer) window.clearInterval(state.timer);
    workspaces.delete(workspaceId);
  }
  pagehideListener?.();
  visibilityListener?.();
}
