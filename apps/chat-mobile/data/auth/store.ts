// Ported from usf apps/mobile/data/auth-store.ts: the Zustand half of auth
// (user + loading + status) over the native session. The token lifecycle, the
// epoch and the Keychain are the session's; the store only asks it and loads /me.
//
// Every transition of user, isLoading and status is the reducer's
// (data/auth/machine.ts, enumerated by machine.test.ts); this file is its
// driver: it turns the commands below and the session's emits into events, runs
// the effects the reducer asks for (network, Keychain, device store) and feeds
// their answers back.
//
// A cold start is offline-first: the stored credential, the last
// signed-in person, the workspace and the unsent messages are read together;
// with a credential and a stored person the inbox opens at once, on the cached
// rooms, and /me revalidates behind it. Only a server verdict signs out (the
// session's onChange(null), the api layer's onUnauthorized): offline, a 5xx or
// a timeout keep the person in.
import type { User } from "@uniwork/core/types/user";
import { create } from "zustand";
import { ApiError, api } from "../api";
import { chatSendDeps, clearChatOutbox } from "../chat-send";
import { clearPendingOps, pendingOpsDeps } from "../pending-ops";
import { wipeDeviceTraces, wipeSessionTraces } from "../local-wipe";
import { firstLaunchOfInstall } from "../install-marker";
import { forgetPushToken, unregisterPushToken } from "../push";
import { workspaceListOptions } from "../queries/workspaces";
import { queryClient } from "../query-client";
import { dropAccountCache, restoreAccountCache } from "../query-persister";
import { forgetChatSyncHeads } from "../chat-sync/heads";
import { clearAccountCache } from "../remote-config";
import { bestEffort, setReportUser } from "../report";
import { currentSessionEpoch } from "../session-epoch";
import { hydrateChatSendStore, useChatSendStore } from "../stores/chat-send-store";
import { hydrateDraftStore, useDraftStore } from "../stores/draft-store";
import { hydrateReportedMessagesStore, useReportedMessagesStore } from "../stores/reported-messages-store";
import { hydratePendingOpsStore, usePendingOpsStore } from "../stores/pending-ops-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import { openDeviceStore } from "../storage/device-store";
import { session } from "./flow";
import { initialAuthModel, reduce, type AuthEffect, type AuthEvent, type AuthModel, type AuthStatus, type CacheFor } from "./machine";
import { forgetLastUser, readLastUser, rememberUser } from "./last-user";
import { restoreInterruptedSignIn } from "./pending-sign-in";
import { dropChoice, forgetSignIn, runSignIn, type SignInOutcome, type SignInRequest } from "./sign-in";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  /** where the auth lifecycle stands (data/auth/machine.ts › AuthStatus) */
  status: AuthStatus;
  /** boot: restore the stored session, then /me */
  initialize: () => Promise<void>;
  /**
   * One sign-in (data/auth/sign-in.ts: the browser by default, a sheet, email and password, a second factor, the
   * choice screen's ways), then /me. Resolves with what came of it: signed in (with what to say once), a second factor
   * or a choice now waiting (data/auth/pending-sign-in.ts), or nothing (a sheet closed). Rejects when it failed: a
   * door's verdict with its TransportError code (data/auth/transport.ts), read by core's readSignInFailure.
   */
  login: (request?: SignInRequest) => Promise<SignInOutcome>;
  /** the choice screen's identity is left unspent ("Hủy", Back, "Không liên kết"): data/auth/sign-in.ts › dropChoice */
  dropChoice: () => void;
  /** a session adopted outside login() (a deep-link callback after a dismissed browser): /me, once, no restore */
  adoptSession: () => Promise<void>;
  /**
   * The session emitted null: the server ended it (refresh refused, device revoked), or a sign-out already under way.
   * Recorded so a boot or a sign-in on the way lets nobody in; true when someone is in and the app must sign out now.
   */
  sessionEnded: () => boolean;
  logout: () => Promise<void>;
  /**
   * After POST /me/delete: the server already ended every session and push
   * subscription of the account, so nothing is asked of it; everything the
   * account left on this phone is wiped (data/local-wipe.ts).
   */
  accountDeleted: () => Promise<void>;
  /** overwrite the in-memory user after PATCH /me; the server response is the source of truth */
  setUser: (user: User) => void;
}

/** The push unsubscribe may hold a sign-out up this long, no longer (offline, a slow server). */
export const PUSH_UNREGISTER_BUDGET_MS = 3_000;

/**
 * Every sign-out drops this phone's push subscription first, while a live
 * session can still authorize the call (otherwise push kept arriving after a
 * sign-out). A sign-out the server made (the session is already over) cannot
 * call; the server skips an ended device session's subscription itself.
 */
async function dropPushSubscription(): Promise<void> {
  if (session.status() === "signed-out") {
    forgetPushToken();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PUSH_UNREGISTER_BUDGET_MS);
  });
  await Promise.race([unregisterPushToken(api).catch(bestEffort("auth", "push not unregistered", "report")), budget]);
  clearTimeout(timer);
}

/**
 * The one /me on the wire (the machine has login(), the session's emit, the boot and its revalidation share it).
 * A 401 ends the session only when the session already ended it (a server verdict on refresh); a 401 the api layer
 * let through while the server is unreachable, a network blip or a 5xx keep it for the next attempt. The answer
 * carries `sessionsEnded` back, so the machine drops one sent under a session that has ended since.
 */
async function loadMe(sessionsEnded: number): Promise<AuthEvent> {
  const epoch = currentSessionEpoch();
  let user: User | null = null;
  try {
    user = await api.getMe();
    if (user) void rememberUser(user, epoch);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401 && session.status() === "signed-out") await session.logout();
  }
  return { type: "meAnswered", user, sessionEnded: session.status() === "signed-out", sessionsEnded };
}

/**
 * Everything an account left on this phone besides its session: workspace, stored person, cached rooms, queues and
 * their files, drafts, the messages they reported, and the cached photos, tray notifications and badge
 * (data/local-wipe.ts › wipeSessionTraces).
 */
async function forgetAccountLocally(): Promise<void> {
  await Promise.all([useWorkspaceStore.getState().clear(), forgetLastUser(), dropAccountCache(), forgetChatSyncHeads(), wipeSessionTraces()]);
  clearAccountCache(queryClient, openDeviceStore);
  clearChatOutbox(chatSendDeps);
  clearPendingOps(pendingOpsDeps);
  useDraftStore.getState().clearAll();
  useReportedMessagesStore.getState().clearAll();
}

/** Something of the last person is still on this phone: who they were, what they queued, or what they left unsent. */
function leftTraces(lastUser: User | null): boolean {
  return (
    lastUser !== null ||
    useChatSendStore.getState().entries.length > 0 ||
    usePendingOpsStore.getState().ops.length > 0 ||
    Object.keys(useDraftStore.getState().drafts).length > 0 ||
    Object.keys(useReportedMessagesStore.getState().reported).length > 0
  );
}

/**
 * What the device kept across the last run: the unsent messages, the queued reads, reactions and votes, the drafts,
 * and the messages the person reported (hidden from them).
 */
async function hydrateDeviceState(): Promise<void> {
  await Promise.all([hydrateChatSendStore(), hydratePendingOpsStore(), hydrateDraftStore(), hydrateReportedMessagesStore()]);
}

/**
 * The cold start's reads, together. iOS keeps Keychain items when the app is deleted: on the first launch of a new
 * install, the previous install's session and person are discarded (its device revoked in the background), never
 * resumed. restore() may emit the stored token before it resolves (app/_layout.tsx answers with adoptSession).
 */
async function readStored(): Promise<AuthEvent> {
  if (await firstLaunchOfInstall()) await Promise.all([session.discardStored(), forgetLastUser()]);
  const [hasCredential, lastUser] = await Promise.all([
    session.restore({ awaitRefresh: false }),
    readLastUser(),
    useWorkspaceStore.getState().restore(),
    hydrateDeviceState(),
    // A choice screen the last run was closed on: the sign-in screen says so (pending-sign-in.ts).
    restoreInterruptedSignIn(Date.now()).catch(bestEffort("auth", "interrupted sign-in not read", "breadcrumb")),
  ]);
  // A refresh the server refused while the rest was read already ended the session.
  return { type: "storedPersonRead", hasCredential, lastUser, sessionEnded: hasCredential && session.status() === "signed-out" };
}

async function restoreCache(user: User, purposes: readonly CacheFor[], sessionsEnded: number): Promise<AuthEvent> {
  await restoreAccountCache(user.id);
  return { type: "cacheRestored", user, for: purposes, sessionEnded: session.status() === "signed-out", sessionsEnded };
}

/**
 * The sign-in a login() call armed, taken by the sessionLogin effect it dispatches (perform runs a command's first
 * effect before dispatch returns). The password or code it carries stays in this closure: the machine's events and
 * effects name only the method.
 */
let armed: (() => Promise<void>) | null = null;

async function signIn(): Promise<AuthEvent> {
  const run = armed;
  armed = null;
  if (run) await run();
  return { type: "loginCompleted", signedIn: session.status() === "signed-in" };
}

const BROWSER: SignInRequest = { method: "browser" };

const WIPED: AuthEvent = { type: "wiped" };

/** One effect; a synchronous one answers at once, so a command's first effects run before it returns. */
function perform(effect: AuthEffect): AuthEvent | undefined | Promise<AuthEvent | undefined> {
  switch (effect.type) {
    case "readStored":
      return readStored();
    case "restoreCache":
      return restoreCache(effect.user, effect.for, effect.sessionsEnded);
    case "loadMe":
      return loadMe(effect.sessionsEnded);
    case "sessionLogin":
      return signIn();
    case "reportUser":
      setReportUser(effect.userId);
      return undefined;
    case "rememberProfile":
      void rememberUser(effect.user, currentSessionEpoch());
      return undefined;
    case "dropPushSubscription":
      return dropPushSubscription().then(() => undefined);
    case "forgetPushToken":
      forgetPushToken();
      return undefined;
    case "endSession":
      // What a sign-in left waiting (a second step, a ticket) never outlives the session it was for.
      forgetSignIn();
      return session.logout().then(() => undefined);
    case "wipeAccount":
      return forgetAccountLocally().then(() => WIPED);
    case "wipeLeftovers":
      return leftTraces(effect.lastUser) ? forgetAccountLocally().then(() => WIPED) : Promise.resolve(WIPED);
    case "wipeDevice":
      return wipeDeviceTraces(effect.workspaceIds).then(() => undefined);
    case "requestSignOut":
      // The app signs out (app/_layout.tsx › signOut, which also navigates): sessionEnded() answers it.
      return undefined;
  }
}

let machine: AuthModel = initialAuthModel;
const waiters = new Set<{ until: (model: AuthModel) => boolean; resolve: () => void }>();

/** The machine's model, with the user and loading flag the store holds (PATCH /me and tests set them directly). */
function currentModel(): AuthModel {
  const { user, isLoading } = useAuthStore.getState();
  return { ...machine, user, isLoading };
}

/** Resolves once the machine reaches `until`: a command that joined an adoption or a /me already on the wire. */
function settledWhen(until: (model: AuthModel) => boolean): Promise<void> {
  if (until(machine)) return Promise.resolve();
  return new Promise((resolve) => waiters.add({ until, resolve }));
}

function commit(next: AuthModel): void {
  machine = next;
  const state = useAuthStore.getState();
  const patch: Partial<Pick<AuthState, "user" | "isLoading" | "status">> = {};
  if (state.user !== next.user) patch.user = next.user;
  if (state.isLoading !== next.isLoading) patch.isLoading = next.isLoading;
  if (state.status !== next.status) patch.status = next.status;
  if (Object.keys(patch).length > 0) useAuthStore.setState(patch);
  for (const waiter of [...waiters]) {
    if (!waiter.until(next)) continue;
    waiters.delete(waiter);
    waiter.resolve();
  }
}

/** One event: the transition is committed at once; `settled` follows its effects and every answer they bring. */
function dispatch(event: AuthEvent): { effects: readonly AuthEffect[]; settled: Promise<void> } {
  const step = reduce(currentModel(), event);
  commit(step.model);
  return { effects: step.effects, settled: runEffects(step.effects) };
}

/** In order; an effect's answer is dispatched before the next effect runs. */
async function runEffects(effects: readonly AuthEffect[]): Promise<void> {
  for (const effect of effects) {
    if (effect.type === "loadMe" && effect.detached) {
      // The revalidation behind the inbox: nobody waits on it.
      void loadMe(effect.sessionsEnded)
        .then((answer) => dispatch(answer).settled)
        .catch(bestEffort("auth", "revalidation not applied", "report"));
      continue;
    }
    const answer = perform(effect);
    const event = answer instanceof Promise ? await answer : answer;
    if (event) await dispatch(event).settled;
  }
}

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  isLoading: true,
  status: initialAuthModel.status,

  initialize: async () => {
    await dispatch({ type: "bootStarted" }).settled;
    // The boot may have joined a /me a sign-in started (the restore's own emit): it ends with that answer.
    await settledWhen((m) => m.boot === "idle");
  },

  login: async (request = BROWSER) => {
    let outcome: SignInOutcome = { kind: "dismissed" };
    armed = async () => {
      outcome = await runSignIn(request);
    };
    try {
      await dispatch({ type: "loginStarted", method: request.method }).settled;
    } finally {
      armed = null;
    }
    await settledWhen((m) => m.adoption === "idle");
    return outcome;
  },

  dropChoice,

  adoptSession: async () => {
    await dispatch({ type: "sessionEmitted", token: true }).settled;
    await settledWhen((m) => m.adoption === "idle");
  },

  sessionEnded: () => dispatch({ type: "sessionEmitted", token: false }).effects.some((e) => e.type === "requestSignOut"),

  logout: async () => {
    await dispatch({ type: "logout" }).settled;
  },

  accountDeleted: async () => {
    // Read before the cache goes: the workspaces whose pins this phone keeps.
    const workspaceIds = (queryClient.getQueryData(workspaceListOptions().queryKey) ?? []).map((w) => w.id);
    await dispatch({ type: "accountDeleted", workspaceIds }).settled;
  },

  setUser: (user) => {
    void dispatch({ type: "profileUpdated", user }).settled;
  },
}));
