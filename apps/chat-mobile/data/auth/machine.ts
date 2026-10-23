// The auth/boot lifecycle as one pure reducer: (model, event) → (model, effects). Every change of the store's
// user, isLoading and status is a transition here; data/auth/store.ts runs the effects (network, Keychain, device
// store) and feeds their answers back as events. Before this, the lifecycle was an implicit state machine spread over
// initialize / adoptSession / login / logout and the session's onChange, and it raced four times in three days
// (e1a4d636f, 3b141d5e6, aebaf4de1, f077d212e). machine.test.ts enumerates the orders those events can land in and
// holds the invariants:
//  - offline-first: a credential and a stored person open the app, whatever the network does;
//  - only a server verdict (or the person) signs out, and a verdict always does;
//  - nobody is let in once the store knows the session ended;
//  - only a sign-out (the person's, the server's, or no credential at a cold start) or an account deletion wipes the
//    outbox, the queues and the cached rooms.
import type { User } from "@uniwork/core/types/user";

/** What the screens may branch on. */
export type AuthStatus =
  /** initialize reads the session, the stored person, the workspace and the queues */
  | "booting"
  /** a credential is held: the stored person's cached rooms are read, or (nobody stored) /me decides */
  | "restoring"
  /** the stored person is in; /me has not confirmed them (offline, a 5xx, or still on the wire) */
  | "signedInOffline"
  | "signedIn"
  /** a sign-out (the person's, the server's at a cold start, an account deletion) is wiping the phone */
  | "signingOut"
  | "signedOut";

type BootStage = "notStarted" | "reading" | "restoringStored" | "awaitingMe" | "restoringMe" | "wiping" | "idle";
type AdoptionStage = "idle" | "awaitingMe" | "restoring";
/** Whose cache restore it is: the stored person's at boot, /me's person at boot (nobody stored), a sign-in's. */
export type CacheFor = "stored" | "boot" | "adopt";

/** Who waits on the one /me on the wire (login, the session's emit, the boot and its revalidation share it). */
interface MeWaiters {
  readonly boot: boolean;
  readonly adopt: boolean;
  readonly revalidate: boolean;
}

export interface AuthModel {
  readonly status: AuthStatus;
  readonly user: User | null;
  readonly isLoading: boolean;
  /** /me, a sign-in or PATCH /me vouched for `user`; false while only the stored copy is in */
  readonly confirmed: boolean;
  /** the server ended the session (or the person did) and no token came since */
  readonly sessionEnded: boolean;
  readonly boot: BootStage;
  readonly adoption: AdoptionStage;
  readonly me: MeWaiters | null;
  /** a sign-out or an account deletion is wiping */
  readonly ending: boolean;
}

export type AuthEvent =
  | { type: "bootStarted" }
  /** the session, the stored person, the workspace and the queues are read; `sessionEnded`: the session said signed-out */
  | { type: "storedPersonRead"; hasCredential: boolean; lastUser: User | null; sessionEnded: boolean }
  | { type: "cacheRestored"; user: User; for: readonly CacheFor[]; sessionEnded: boolean }
  /** null: no usable answer (offline, 5xx, timeout, or a 401 the session turned into a verdict) */
  | { type: "meAnswered"; user: User | null; sessionEnded: boolean }
  /** MobileSession.onChange: a token (restore, a sign-in, a rotation), or null when the server ended the session */
  | { type: "sessionEmitted"; token: boolean }
  | { type: "loginStarted" }
  | { type: "loginCompleted"; signedIn: boolean }
  | { type: "logout" }
  | { type: "accountDeleted"; workspaceIds: readonly string[] }
  | { type: "wiped" }
  /** PATCH /me answered: the server's copy is the source of truth */
  | { type: "profileUpdated"; user: User };

export type AuthEffect =
  /** firstLaunchOfInstall, then session.restore + readLastUser + the workspace + the queues → storedPersonRead */
  | { type: "readStored" }
  /** restoreAccountCache → cacheRestored */
  | { type: "restoreCache"; user: User; for: readonly CacheFor[] }
  /** GET /me (a 401 the session already ended logs the session out) → meAnswered; detached: nobody awaits it */
  | { type: "loadMe"; detached: boolean }
  /** the browser sign-in → loginCompleted */
  | { type: "sessionLogin" }
  | { type: "reportUser"; userId: string | null }
  | { type: "rememberProfile"; user: User }
  | { type: "dropPushSubscription" }
  | { type: "forgetPushToken" }
  /** session.logout(): the epoch moves, the Keychain clears, the device is revoked in the background */
  | { type: "endSession" }
  /** everything the account left on this phone (store.ts › forgetAccountLocally) → wiped */
  | { type: "wipeAccount" }
  /** the same, only when the last person left something (who they were, a queue, a draft) → wiped */
  | { type: "wipeLeftovers"; lastUser: User | null }
  | { type: "wipeDevice"; workspaceIds: readonly string[] }
  /** someone is in and the server ended the session: the app signs out (app/_layout.tsx › signOut) */
  | { type: "requestSignOut" };

interface AuthStep {
  readonly model: AuthModel;
  readonly effects: readonly AuthEffect[];
}

export const initialAuthModel: AuthModel = {
  status: "booting",
  user: null,
  isLoading: true,
  confirmed: false,
  sessionEnded: false,
  boot: "notStarted",
  adoption: "idle",
  me: null,
  ending: false,
};

const NO_WAITERS: MeWaiters = { boot: false, adopt: false, revalidate: false };

/** The status follows from the facts, so no transition can leave it saying something else. */
function statusOf(m: Omit<AuthModel, "status">): AuthStatus {
  if (m.ending || m.boot === "wiping") return "signingOut";
  if (m.boot === "notStarted" || m.boot === "reading") return "booting";
  if (m.boot !== "idle") return "restoring";
  if (!m.user) return "signedOut";
  return m.confirmed ? "signedIn" : "signedInOffline";
}

/** Joins the /me on the wire, or starts one. */
function askMe(m: AuthModel, waiter: keyof MeWaiters, detached: boolean): AuthStep {
  if (m.me) return { model: { ...m, me: { ...m.me, [waiter]: true } }, effects: [] };
  return { model: { ...m, me: { ...NO_WAITERS, [waiter]: true } }, effects: [{ type: "loadMe", detached }] };
}

/** A sign-in's adoption: login() and the session's emit share one. */
function adopt(m: AuthModel): AuthStep {
  if (m.adoption !== "idle") return { model: m, effects: [] };
  return askMe({ ...m, adoption: "awaitingMe" }, "adopt", false);
}

/** `user` may come in now: nobody is in, or the same person is (a fresher copy). */
function admits(m: AuthModel, user: User): boolean {
  return !m.sessionEnded && (!m.user || m.user.id === user.id);
}

function onStoredPersonRead(m: AuthModel, e: Extract<AuthEvent, { type: "storedPersonRead" }>): AuthStep {
  if (m.boot !== "reading") return { model: m, effects: [] };
  const sessionEnded = m.sessionEnded || e.sessionEnded;
  // No credential, or a refresh the server refused while the rest was read (its onChange(null) found nobody to sign
  // out): what the last person left goes as on a sign-out, so the next account never sees or posts their unsent messages.
  if (!e.hasCredential || sessionEnded) {
    return { model: { ...m, sessionEnded, boot: "wiping" }, effects: [{ type: "wipeLeftovers", lastUser: e.lastUser }] };
  }
  if (e.lastUser) {
    return { model: { ...m, boot: "restoringStored" }, effects: [{ type: "restoreCache", user: e.lastUser, for: ["stored"] }] };
  }
  // Nobody stored yet (the first start of this build): /me decides.
  return askMe({ ...m, boot: "awaitingMe" }, "boot", false);
}

function onCacheRestored(m: AuthModel, e: Extract<AuthEvent, { type: "cacheRestored" }>): AuthStep {
  let next: AuthModel = { ...m, sessionEnded: m.sessionEnded || e.sessionEnded };
  const effects: AuthEffect[] = [];
  if (e.for.includes("stored") && m.boot === "restoringStored") {
    if (next.sessionEnded) {
      // A verdict landed while the cached rooms were read: letting the stored person in now would leave them in with
      // no session, past the one sign-out.
      next = { ...next, boot: "wiping" };
      effects.push({ type: "wipeAccount" });
    } else {
      next = { ...next, user: e.user, confirmed: false, isLoading: false, boot: "idle" };
      // Behind the inbox: a fresh profile replaces the stored one; no answer keeps it.
      const revalidate = askMe(next, "revalidate", true);
      next = revalidate.model;
      effects.push(...revalidate.effects);
    }
  }
  if (e.for.includes("boot") && m.boot === "restoringMe") {
    if (next.sessionEnded) {
      next = { ...next, boot: "wiping" };
      effects.push({ type: "wipeLeftovers", lastUser: null });
    } else {
      next = { ...next, user: e.user, confirmed: true, isLoading: false, boot: "idle" };
    }
  }
  if (e.for.includes("adopt") && m.adoption === "restoring") {
    next = admits(next, e.user) ? { ...next, adoption: "idle", user: e.user, confirmed: true } : { ...next, adoption: "idle" };
  }
  return { model: next, effects };
}

function onMeAnswered(m: AuthModel, e: Extract<AuthEvent, { type: "meAnswered" }>): AuthStep {
  const waiters = m.me ?? NO_WAITERS;
  let next: AuthModel = { ...m, me: null, sessionEnded: m.sessionEnded || e.sessionEnded };
  const effects: AuthEffect[] = [];
  const restoreFor: CacheFor[] = [];
  const user = e.user;
  if (waiters.boot && m.boot === "awaitingMe") {
    if (user && !next.sessionEnded) {
      next = { ...next, boot: "restoringMe" };
      restoreFor.push("boot");
    } else if (next.sessionEnded) {
      // A first start whose /me found the session ended: the queue left behind goes too.
      next = { ...next, boot: "wiping" };
      effects.push({ type: "wipeLeftovers", lastUser: null });
    } else {
      // No answer: nobody comes in, and nobody already in is written over.
      next = { ...next, boot: "idle", isLoading: false };
    }
  }
  if (waiters.adopt && m.adoption === "awaitingMe") {
    // No answer changes nothing (it would write nobody over the stored person the boot let in); an answer about someone
    // else than the person in is stale; an answer after the session ended lets nobody in.
    if (user && admits(next, user)) {
      next = { ...next, adoption: "restoring" };
      restoreFor.push("adopt");
    } else {
      next = { ...next, adoption: "idle" };
    }
  }
  if (waiters.revalidate && user && m.user?.id === user.id) next = { ...next, user, confirmed: true };
  if (user && restoreFor.length) effects.push({ type: "restoreCache", user, for: restoreFor });
  return { model: next, effects };
}

function transition(m: AuthModel, e: AuthEvent): AuthStep {
  switch (e.type) {
    case "bootStarted":
      return { model: { ...m, boot: "reading", sessionEnded: false }, effects: [{ type: "readStored" }] };
    case "storedPersonRead":
      return onStoredPersonRead(m, e);
    case "cacheRestored":
      return onCacheRestored(m, e);
    case "meAnswered":
      return onMeAnswered(m, e);
    case "sessionEmitted":
      if (!e.token) {
        // The server ended the session. Someone in is signed out now, not at the next request; a boot or a sign-in
        // still on the way reads it at its next step.
        return { model: { ...m, sessionEnded: true }, effects: m.user ? [{ type: "requestSignOut" }] : [] };
      }
      // A token rotation with someone in changes nothing; otherwise (a deep-link callback, the restore's own emit)
      // the person behind the token is loaded.
      return m.user ? { model: { ...m, sessionEnded: false }, effects: [] } : adopt({ ...m, sessionEnded: false });
    case "loginStarted":
      return { model: m, effects: [{ type: "sessionLogin" }] };
    case "loginCompleted":
      return e.signedIn ? adopt({ ...m, sessionEnded: false }) : { model: m, effects: [] };
    case "logout":
      return {
        model: { ...m, user: null, confirmed: false, ending: true, sessionEnded: true },
        effects: [{ type: "reportUser", userId: null }, { type: "dropPushSubscription" }, { type: "endSession" }, { type: "wipeAccount" }],
      };
    case "accountDeleted":
      return {
        model: { ...m, user: null, confirmed: false, ending: true, sessionEnded: true },
        effects: [
          { type: "reportUser", userId: null },
          { type: "forgetPushToken" },
          { type: "endSession" },
          { type: "wipeAccount" },
          { type: "wipeDevice", workspaceIds: e.workspaceIds },
        ],
      };
    case "wiped":
      return {
        model: { ...m, ending: false, ...(m.boot === "wiping" ? { boot: "idle" as const, isLoading: false } : {}) },
        effects: [],
      };
    case "profileUpdated":
      return { model: { ...m, user: e.user, confirmed: true }, effects: [{ type: "rememberProfile", user: e.user }] };
  }
}

/** One transition. Crash reports name the person in by opaque id: every change of who is in is reported. */
export function reduce(model: AuthModel, event: AuthEvent): AuthStep {
  const step = transition(model, event);
  const next = { ...step.model, status: statusOf(step.model) };
  const userId = next.user?.id ?? null;
  const reported = step.effects.some((e) => e.type === "reportUser");
  const changed = (model.user?.id ?? null) !== userId;
  const effects: readonly AuthEffect[] = !reported && changed ? [{ type: "reportUser", userId }, ...step.effects] : step.effects;
  return { model: next, effects };
}
