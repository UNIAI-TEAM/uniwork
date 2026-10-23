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
//    outbox, the queues and the cached rooms;
//  - an answer (/me, a cache restore) started under a session that has ended since is never taken for the session
//    live now: each carries the count of ended sessions it started under (`sessionsEnded`);
//  - memory holds only the rooms of the person in: a cache restore whose person is not let in is followed by a full
//    wipe, and a sign-in's restore waits for a wipe under way, so no copy takes in another person's rooms.
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
/** awaitingWipe: /me answered while a wipe is under way; the restore starts once it is done (`adoptee` waits) */
type AdoptionStage = "idle" | "awaitingMe" | "awaitingWipe" | "restoring";
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
  /** the person a sign-in's /me answered, while the adoption waits for a wipe under way */
  readonly adoptee: User | null;
  readonly me: MeWaiters | null;
  /** wipes under way (a sign-out, an account deletion, a cache restore nobody was let in by, the boot's) */
  readonly wiping: number;
  /** sessions ended so far: a /me or a cache restore started under an earlier count answers for a session that is over */
  readonly sessionsEnded: number;
}

export type AuthEvent =
  | { type: "bootStarted" }
  /** the session, the stored person, the workspace and the queues are read; `sessionEnded`: the session said signed-out */
  | { type: "storedPersonRead"; hasCredential: boolean; lastUser: User | null; sessionEnded: boolean }
  /** `sessionsEnded`: the restoreCache effect's own, handed back */
  | { type: "cacheRestored"; user: User; for: readonly CacheFor[]; sessionEnded: boolean; sessionsEnded: number }
  /** null: no usable answer (offline, 5xx, timeout, or a 401 the session turned into a verdict); `sessionsEnded`: the loadMe's */
  | { type: "meAnswered"; user: User | null; sessionEnded: boolean; sessionsEnded: number }
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
  | { type: "restoreCache"; user: User; for: readonly CacheFor[]; sessionsEnded: number }
  /** GET /me (a 401 the session already ended logs the session out) → meAnswered; detached: nobody awaits it */
  | { type: "loadMe"; detached: boolean; sessionsEnded: number }
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
  adoptee: null,
  me: null,
  wiping: 0,
  sessionsEnded: 0,
};

const NO_WAITERS: MeWaiters = { boot: false, adopt: false, revalidate: false };

/** The status follows from the facts, so no transition can leave it saying something else. */
function statusOf(m: Omit<AuthModel, "status">): AuthStatus {
  if (m.wiping > 0 || m.boot === "wiping") return "signingOut";
  if (m.boot === "notStarted" || m.boot === "reading") return "booting";
  if (m.boot !== "idle") return "restoring";
  if (!m.user) return "signedOut";
  return m.confirmed ? "signedIn" : "signedInOffline";
}

/** Joins the /me on the wire, or starts one. */
function askMe(m: AuthModel, waiter: keyof MeWaiters, detached: boolean): AuthStep {
  if (m.me) return { model: { ...m, me: { ...m.me, [waiter]: true } }, effects: [] };
  return { model: { ...m, me: { ...NO_WAITERS, [waiter]: true } }, effects: [{ type: "loadMe", detached, sessionsEnded: m.sessionsEnded }] };
}

/** A cache restore, tagged with the session it starts under. */
function restore(m: AuthModel, user: User, purposes: readonly CacheFor[]): AuthEffect {
  return { type: "restoreCache", user, for: purposes, sessionsEnded: m.sessionsEnded };
}

/** One more wipe under way; `wiped` answers each. */
function wipe(m: AuthModel, effect: Extract<AuthEffect, { type: "wipeAccount" | "wipeLeftovers" }>): AuthStep {
  return { model: { ...m, wiping: m.wiping + 1 }, effects: [effect] };
}

/**
 * The session ended (the server's verdict, a sign-out, an account deletion). Nothing on the wire for it may answer
 * for the next one: the /me is dropped (its answer is stale by `sessionsEnded`), and so is a sign-in's adoption.
 * A boot waiting on that /me wipes what the last person left, and the rooms a sign-in's restore is hydrating go with
 * a full wipe while nobody is in (someone in is signed out, which wipes). `wipes`: the caller wipes the account itself.
 */
function endOfSession(m: AuthModel, wipes: boolean): AuthStep {
  let next: AuthModel = { ...m, sessionEnded: true, sessionsEnded: m.sessionsEnded + 1, me: null, adoption: "idle", adoptee: null };
  if (m.boot === "awaitingMe") next = { ...next, boot: "wiping" };
  if (wipes) return { model: next, effects: [] };
  if (m.adoption === "restoring" && !m.user) return wipe(next, { type: "wipeAccount" });
  if (m.boot === "awaitingMe") return wipe(next, { type: "wipeLeftovers", lastUser: null });
  return { model: next, effects: [] };
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
    return wipe({ ...m, sessionEnded, boot: "wiping" }, { type: "wipeLeftovers", lastUser: e.lastUser });
  }
  if (e.lastUser) {
    return { model: { ...m, boot: "restoringStored" }, effects: [restore(m, e.lastUser, ["stored"])] };
  }
  // Nobody stored yet (the first start of this build): /me decides.
  return askMe({ ...m, boot: "awaitingMe" }, "boot", false);
}

function onCacheRestored(m: AuthModel, e: Extract<AuthEvent, { type: "cacheRestored" }>): AuthStep {
  // A restore started under a session that ended since: its own sessionEnded reads the session live now, not its own.
  const stale = e.sessionsEnded !== m.sessionsEnded;
  let next: AuthModel = stale ? m : { ...m, sessionEnded: m.sessionEnded || e.sessionEnded };
  const over = stale || next.sessionEnded;
  let wipes = false;
  const effects: AuthEffect[] = [];
  if (e.for.includes("stored") && m.boot === "restoringStored") {
    if (over) {
      // A verdict landed while the cached rooms were read: letting the stored person in now would leave them in with
      // no session, past the one sign-out.
      next = { ...next, boot: "wiping" };
      wipes = true;
    } else {
      next = { ...next, user: e.user, confirmed: false, isLoading: false, boot: "idle" };
      // Behind the inbox: a fresh profile replaces the stored one; no answer keeps it.
      const revalidate = askMe(next, "revalidate", true);
      next = revalidate.model;
      effects.push(...revalidate.effects);
    }
  }
  if (e.for.includes("boot") && m.boot === "restoringMe") {
    if (over) {
      // The rooms this restore hydrated are of a person nobody lets in: they go, all of them.
      next = { ...next, boot: "wiping" };
      wipes = true;
    } else {
      next = { ...next, user: e.user, confirmed: true, isLoading: false, boot: "idle" };
    }
  }
  // A stale answer is not this adoption's: the session's end already dropped that one (and wiped what it hydrated).
  if (!stale && e.for.includes("adopt") && m.adoption === "restoring") {
    if (admits(next, e.user)) {
      next = { ...next, adoption: "idle", user: e.user, confirmed: true };
    } else {
      next = { ...next, adoption: "idle" };
      // Refused because the session ended: the rooms it hydrated go, unless someone in is being signed out (that wipes).
      if (next.sessionEnded && !next.user) wipes = true;
    }
  }
  if (!wipes) return { model: next, effects };
  const wiped = wipe(next, { type: "wipeAccount" });
  return { model: wiped.model, effects: [...effects, ...wiped.effects] };
}

function onMeAnswered(m: AuthModel, e: Extract<AuthEvent, { type: "meAnswered" }>): AuthStep {
  // Sent under a session that has ended since: it answers for someone who may not be the person of the session now.
  if (e.sessionsEnded !== m.sessionsEnded) return { model: m, effects: [] };
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
      const wiped = wipe({ ...next, boot: "wiping" }, { type: "wipeLeftovers", lastUser: null });
      next = wiped.model;
      effects.push(...wiped.effects);
    } else {
      // No answer: nobody comes in, and nobody already in is written over.
      next = { ...next, boot: "idle", isLoading: false };
    }
  }
  if (waiters.adopt && m.adoption === "awaitingMe") {
    // No answer changes nothing (it would write nobody over the stored person the boot let in); an answer about someone
    // else than the person in is stale; an answer after the session ended lets nobody in.
    // A wipe under way (a sign-out just before this sign-in) clears memory only when it is done: the restore waits for
    // it, or this person's copy would take in the rooms of the one before.
    if (user && admits(next, user) && next.wiping > 0) {
      next = { ...next, adoption: "awaitingWipe", adoptee: user };
    } else if (user && admits(next, user)) {
      next = { ...next, adoption: "restoring" };
      restoreFor.push("adopt");
    } else {
      next = { ...next, adoption: "idle" };
    }
  }
  if (waiters.revalidate && user && m.user?.id === user.id) next = { ...next, user, confirmed: true };
  if (user && restoreFor.length) effects.push(restore(next, user, restoreFor));
  return { model: next, effects };
}

/** One wipe done. Once none is under way, the boot settles and a sign-in that waited restores its person's rooms. */
function onWiped(m: AuthModel): AuthStep {
  const next: AuthModel = { ...m, wiping: Math.max(0, m.wiping - 1) };
  if (next.wiping > 0) return { model: next, effects: [] };
  const settled: AuthModel = next.boot === "wiping" ? { ...next, boot: "idle", isLoading: false } : next;
  if (settled.adoption !== "awaitingWipe" || !settled.adoptee) return { model: settled, effects: [] };
  return { model: { ...settled, adoption: "restoring", adoptee: null }, effects: [restore(settled, settled.adoptee, ["adopt"])] };
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
        // The server ended the session. Someone in is signed out now, not at the next request; a boot reading the
        // cached rooms reads it at its next step.
        const ended = endOfSession(m, false);
        return { model: ended.model, effects: m.user ? [{ type: "requestSignOut" }, ...ended.effects] : ended.effects };
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
        model: { ...endOfSession(m, true).model, user: null, confirmed: false, wiping: m.wiping + 1 },
        effects: [{ type: "reportUser", userId: null }, { type: "dropPushSubscription" }, { type: "endSession" }, { type: "wipeAccount" }],
      };
    case "accountDeleted":
      return {
        model: { ...endOfSession(m, true).model, user: null, confirmed: false, wiping: m.wiping + 1 },
        effects: [
          { type: "reportUser", userId: null },
          { type: "forgetPushToken" },
          { type: "endSession" },
          { type: "wipeAccount" },
          { type: "wipeDevice", workspaceIds: e.workspaceIds },
        ],
      };
    case "wiped":
      return onWiped(m);
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
