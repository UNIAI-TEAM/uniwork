// The auth/boot reducer (machine.ts) as a model: every order in which a cold start's reads, the session's own
// emits, the server's verdict, /me and the cache reads can land, each checked against the invariants the four
// races of UNI-2053 broke (e1a4d636f, 3b141d5e6, aebaf4de1, f077d212e). The reducer is pure, so the store's
// driver (store.ts) runs exactly what is enumerated here.
import type { User } from "@uniwork/core/types/user";
import { describe, expect, it } from "vitest";
import { initialAuthModel, reduce, type AuthEffect, type AuthEvent, type AuthModel } from "./machine";

const person = (id: string, name = id): User => ({
  id,
  email: `${id}@example.vn`,
  display_name: name,
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
});

const STORED = person("u1", "Stored");
const FRESH = person("u1", "Fresh");

/** Effects that mean "the phone forgets what the account left": the outbox, the queues, the cache. */
const WIPES = new Set<AuthEffect["type"]>(["wipeAccount", "wipeLeftovers"]);

/** Effects that finish later: the scheduler below may land anything between their start and their answer. */
const ASYNC = new Set<AuthEffect["type"]>(["readStored", "restoreCache", "loadMe", "sessionLogin", "wipeAccount", "wipeLeftovers"]);

/**
 * One cold start's world: what the phone holds, whether the network answers, and what the session does. A sign-in
 * world (`signIn`) starts after the boot instead: someone may be in, they sign out, then `signIn` signs in.
 */
interface World {
  hasCredential: boolean;
  stored: User | null;
  online: boolean;
  /** MobileSession.restore adopts a fresh stored token and emits it before it resolves (app/_layout.tsx › adoptSession) */
  tokenAtRestore: boolean;
  /** the server ends the session at some point (refresh refused, device revoked, /me 401 whose refresh is refused) */
  verdict: boolean;
  signIn?: User;
}

/** An effect list still running, waiting on its head; the head started under `server`'s session, at `startedAt`. */
interface Task {
  effects: AuthEffect[];
  server: string | null;
  startedAt: number;
}

interface Sim {
  model: AuthModel;
  tasks: Task[];
  readDone: boolean;
  tokenEmitted: boolean;
  verdict: boolean;
  /** the layout was asked to sign out (requestSignOut) and has not yet */
  signOutPending: boolean;
  loggedOut: boolean;
  /** the sign-in world: the browser sign-in was started, and the session it made emitted its token */
  loginStarted: boolean;
  loginEmitted: boolean;
  /** whose session the server holds now: a /me sent under it answers for them */
  server: string | null;
  /**
   * The query client (data/query-persister.ts): whose rooms memory holds. A restore hydrates its person's copy and
   * dehydrates whatever memory holds into it; a wipe clears memory once it is done, and a restore is inert (hydrates
   * nothing) when a wipe or another restore started after it did (stopWrites).
   */
  held: string[];
  clock: number;
  lastRestoreStart: number;
  lastWipeStart: number;
  wipes: { reason: "verdict" | "no-credential" | "logout" | "none" }[];
  trace: string[];
}

/** The real driver wipes for wipeLeftovers only when the last person left something (store.ts › leftTraces). */
const wipesNow = (effect: AuthEffect) => effect.type === "wipeAccount" || (effect.type === "wipeLeftovers" && effect.lastUser !== null);

function eventFor(world: World, sim: Sim, task: Task, effect: AuthEffect): AuthEvent | null {
  const over = sim.verdict || sim.loggedOut;
  const at = sim.trace.join(" → ");
  switch (effect.type) {
    case "readStored":
      sim.readDone = true;
      return { type: "storedPersonRead", hasCredential: world.hasCredential, lastUser: world.stored, sessionEnded: world.hasCredential && over };
    case "restoreCache": {
      const inert = sim.lastWipeStart > task.startedAt || sim.lastRestoreStart > task.startedAt;
      if (!inert) {
        // The restore's subscription writes what memory holds into this person's copy: nobody else may be in it.
        expect(sim.held.filter((id) => id !== effect.user.id), `${effect.user.id}'s copy takes in another person's rooms: ${at}`).toEqual([]);
        sim.held = [effect.user.id];
      }
      return { type: "cacheRestored", user: effect.user, for: effect.for, sessionEnded: sim.server === null, sessionsEnded: effect.sessionsEnded };
    }
    case "loadMe": {
      // The server answers for the session the request carried, even when that session ended since.
      const user = world.online && task.server ? (task.server === FRESH.id ? FRESH : person(task.server)) : null;
      return { type: "meAnswered", user, sessionEnded: sim.server === null, sessionsEnded: effect.sessionsEnded };
    }
    case "sessionLogin":
      sim.server = world.signIn!.id;
      return { type: "loginCompleted", signedIn: true };
    case "wipeAccount":
    case "wipeLeftovers":
      if (wipesNow(effect)) sim.held = [];
      return { type: "wiped" };
    default:
      return null;
  }
}

function check(world: World, before: AuthModel, sim: Sim): void {
  const m = sim.model;
  const at = sim.trace.join(" → ");
  // Nobody is let in without a session: a person enters only while the server has not ended it.
  if (!before.user && m.user) expect(sim.verdict, `let in after the verdict: ${at}`).toBe(false);
  // Whoever comes in is the person whose session the phone holds now, never the answer of one that ended.
  if (m.user && m.user.id !== before.user?.id) expect(m.user.id, `let in on someone else's session: ${at}`).toBe(sim.server);
  // No sign-in screen while a valid stored session and person exist (offline-first).
  if (!world.signIn && world.hasCredential && world.stored && !sim.verdict && !sim.loggedOut) {
    expect(!m.isLoading && m.user === null, `signed-out screen with a valid stored session: ${at}`).toBe(false);
  }
  // The status says what the store holds.
  if (m.status === "signedIn" || m.status === "signedInOffline") expect(m.user, at).not.toBeNull();
  if (m.status === "signedOut") expect(m.user, at).toBeNull();
}

/** Runs a list's synchronous prefix and parks the rest on its first asynchronous effect, which starts now. */
function runEffects(sim: Sim, effects: readonly AuthEffect[]): void {
  const rest = [...effects];
  while (rest.length && !ASYNC.has(rest[0]!.type)) {
    const effect = rest.shift()!;
    // The reducer asks only while someone is in: after a sign-out, that is the next session's person.
    if (effect.type === "requestSignOut") sim.signOutPending = true;
    // session.logout() ends the session at once (the epoch moves before any await).
    if (effect.type === "endSession") sim.server = null;
  }
  if (!rest.length) return;
  const head = rest[0]!;
  sim.clock += 1;
  if (head.type === "restoreCache") sim.lastRestoreStart = sim.clock;
  if (wipesNow(head)) sim.lastWipeStart = sim.clock;
  sim.tasks.push({ effects: rest, server: sim.server, startedAt: sim.clock });
}

function dispatch(world: World, sim: Sim, event: AuthEvent): void {
  const before = sim.model;
  const step = reduce(sim.model, event);
  sim.model = step.model;
  sim.trace.push(event.type === "sessionEmitted" ? `token:${event.token}` : event.type);
  check(world, before, sim);
  for (const effect of step.effects) {
    if (!WIPES.has(effect.type)) continue;
    const reason = sim.loggedOut ? "logout" : sim.verdict ? "verdict" : !world.hasCredential ? "no-credential" : "none";
    sim.wipes.push({ reason });
  }
  runEffects(sim, step.effects);
}

function clone(sim: Sim): Sim {
  return { ...sim, tasks: sim.tasks.map((t) => ({ ...t, effects: [...t.effects] })), held: [...sim.held], wipes: [...sim.wipes], trace: [...sim.trace] };
}

type Choice =
  | { kind: "task"; index: number }
  | { kind: "token" }
  | { kind: "verdict" }
  | { kind: "signOut" }
  | { kind: "personSignsOut" }
  | { kind: "login" }
  | { kind: "loginEmit" };

function choices(world: World, sim: Sim): Choice[] {
  const out: Choice[] = sim.tasks.map((_, index) => ({ kind: "task", index }));
  if (sim.signOutPending) out.push({ kind: "signOut" });
  if (world.signIn) {
    // Someone is in: they sign out first. Then the sign-in screen starts the browser sign-in.
    if (sim.model.user && !sim.loggedOut && !sim.loginStarted) out.push({ kind: "personSignsOut" });
    if (!sim.model.user && !sim.loginStarted) out.push({ kind: "login" });
    // The session the sign-in made emits its token (app/_layout.tsx › adoptSession), before or after login() hears it.
    const live = sim.server === world.signIn.id;
    if (live && !sim.loginEmitted) out.push({ kind: "loginEmit" });
    if (world.verdict && live && !sim.verdict) out.push({ kind: "verdict" });
    return out;
  }
  // The session emits a fresh stored token inside restore(), before the boot's reads resolve.
  if (world.tokenAtRestore && !sim.tokenEmitted && !sim.readDone && !sim.verdict) out.push({ kind: "token" });
  if (world.verdict && !sim.verdict && (!world.tokenAtRestore || sim.tokenEmitted || sim.readDone)) out.push({ kind: "verdict" });
  return out;
}

function take(world: World, sim: Sim, choice: Choice): void {
  switch (choice.kind) {
    case "task": {
      const [task] = sim.tasks.splice(choice.index, 1);
      const head = task!.effects.shift()!;
      const event = eventFor(world, sim, task!, head);
      // The head's answer is dispatched first; what follows it in its list runs after (data/auth/store.ts › runEffects).
      if (event) dispatch(world, sim, event);
      if (task!.effects.length) runEffects(sim, task!.effects);
      return;
    }
    case "token":
      sim.tokenEmitted = true;
      dispatch(world, sim, { type: "sessionEmitted", token: true });
      return;
    case "verdict":
      sim.verdict = true;
      sim.server = null;
      dispatch(world, sim, { type: "sessionEmitted", token: false });
      return;
    case "signOut":
    case "personSignsOut":
      // app/_layout.tsx › signOut, or the person's own sign-out: logout() once.
      sim.signOutPending = false;
      sim.loggedOut = true;
      dispatch(world, sim, { type: "logout" });
      return;
    case "login":
      sim.loginStarted = true;
      dispatch(world, sim, { type: "loginStarted" });
      return;
    case "loginEmit":
      sim.loginEmitted = true;
      dispatch(world, sim, { type: "sessionEmitted", token: true });
      return;
  }
}

/** Every interleaving in `world`, depth first; `visit` sees each one once everything settled. */
function explore(world: World, sim: Sim, visit: (sim: Sim) => void): void {
  const next = choices(world, sim);
  if (!next.length) {
    visit(sim);
    return;
  }
  for (const choice of next) {
    const branch = clone(sim);
    take(world, branch, choice);
    explore(world, branch, visit);
  }
}

function newSim(model: AuthModel, server: string | null, held: string[]): Sim {
  return {
    model,
    tasks: [],
    readDone: false,
    tokenEmitted: false,
    verdict: false,
    signOutPending: false,
    loggedOut: false,
    loginStarted: false,
    loginEmitted: false,
    server,
    held,
    clock: 0,
    lastRestoreStart: 0,
    lastWipeStart: 0,
    wipes: [],
    trace: [],
  };
}

function coldStart(world: World): Sim[] {
  const sim = newSim(initialAuthModel, world.hasCredential ? STORED.id : null, []);
  dispatch(world, sim, { type: "bootStarted" });
  const ends: Sim[] = [];
  explore(world, sim, (end) => ends.push(end));
  return ends;
}

const WORLDS: World[] = [];
for (const hasCredential of [true, false])
  for (const stored of [STORED, null])
    for (const online of [true, false])
      for (const tokenAtRestore of hasCredential ? [true, false] : [false])
        for (const verdict of hasCredential ? [true, false] : [false]) WORLDS.push({ hasCredential, stored, online, tokenAtRestore, verdict });

const label = (w: World) =>
  `${w.hasCredential ? "credential" : "no credential"}, ${w.stored ? "stored person" : "nobody stored"}, ${w.online ? "online" : "offline"}` +
  `${w.tokenAtRestore ? ", token at restore" : ""}${w.verdict ? ", server verdict" : ""}`;

/** Memory holds only the rooms of the person in, once everything settled: nobody's, when nobody is in. */
function expectCacheOfWhoIsIn(end: Sim): void {
  const at = end.trace.join(" → ");
  expect(end.held.filter((id) => id !== end.model.user?.id), `rooms of someone not in stay in memory: ${at}`).toEqual([]);
}

describe("the auth machine, every interleaving of a cold start", () => {
  it.each(WORLDS.map((w) => [label(w), w] as const))("%s", (_, world) => {
    const ends = coldStart(world);
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      const m = end.model;
      const at = end.trace.join(" → ");
      // The boot always settles: the splash goes.
      expect(m.isLoading, at).toBe(false);
      expect(m.boot, at).toBe("idle");
      // A server verdict always signs out.
      if (end.verdict) expect(m.user, at).toBeNull();
      // Nobody stays in once the store knows the session ended.
      if (m.user) expect(m.sessionEnded, at).toBe(false);
      expectCacheOfWhoIsIn(end);
      if (!end.verdict && world.hasCredential) {
        // Offline-first: the stored person stays in, whatever the network does.
        if (world.stored) expect(m.user?.id, at).toBe(STORED.id);
        // The first start of this build (nobody stored): /me decides.
        else expect(m.user?.id ?? null, at).toBe(world.online ? FRESH.id : null);
        // The outbox is never wiped while the session lives.
        expect(end.wipes, at).toEqual([]);
      }
      // Only a sign-out (the person's, the server's, or no credential at all) wipes the outbox.
      for (const wipe of end.wipes) expect(wipe.reason, at).not.toBe("none");
      if (world.stored && (end.verdict || !world.hasCredential)) expect(end.wipes.length, at).toBeGreaterThan(0);
    }
  });

  it("explores more than one order per world (the enumeration is real)", () => {
    const counts = WORLDS.map((w) => coldStart(w).length);
    expect(Math.max(...counts)).toBeGreaterThan(20);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(200);
  });
});

const NEXT = person("u2", "Next");
const SIGNED_OUT: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" };

/**
 * After the boot: nobody is in, or the stored person is in offline with the revalidation /me still on the wire. They
 * sign out, then NEXT signs in through the browser, whose session emits its token too; the server may end it.
 */
function signIn(world: World): Sim[] {
  if (!world.stored) return exploreFrom(world, newSim(SIGNED_OUT, null, []));
  // The boot let the stored person in offline; its revalidation /me is on the wire under their session.
  const offline: AuthModel = { ...SIGNED_OUT, user: STORED, status: "signedInOffline", me: { boot: false, adopt: false, revalidate: true } };
  const sim = newSim(offline, STORED.id, [STORED.id]);
  sim.clock = 1;
  sim.tasks.push({ effects: [{ type: "loadMe", detached: true, sessionsEnded: 0 }], server: STORED.id, startedAt: 1 });
  return exploreFrom(world, sim);
}

function exploreFrom(world: World, sim: Sim): Sim[] {
  const ends: Sim[] = [];
  explore(world, sim, (end) => ends.push(end));
  return ends;
}

const SIGN_IN_WORLDS: World[] = [];
for (const stored of [STORED, null])
  for (const online of [true, false])
    for (const verdict of [true, false]) SIGN_IN_WORLDS.push({ hasCredential: true, stored, online, tokenAtRestore: false, verdict, signIn: NEXT });

const signInLabel = (w: World) =>
  `${w.stored ? "the stored person in, revalidating, signs out" : "nobody in"}, ${w.online ? "online" : "offline"}${w.verdict ? ", server verdict" : ""}`;

describe("the auth machine, every interleaving of a sign-in", () => {
  it.each(SIGN_IN_WORLDS.map((w) => [signInLabel(w), w] as const))("%s", (_, world) => {
    const ends = signIn(world);
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      const m = end.model;
      const at = end.trace.join(" → ");
      // login() settles (it waits for the adoption), and nothing waits on a /me nobody will answer.
      expect(m.adoption, at).toBe("idle");
      expect(m.me, at).toBeNull();
      // The new session lets its own person in; an ended one lets nobody in.
      expect(m.user?.id ?? null, at).toBe(end.verdict || !world.online ? null : NEXT.id);
      expectCacheOfWhoIsIn(end);
    }
  });

  it("explores the orders of a sign-in (the enumeration is real)", () => {
    const counts = SIGN_IN_WORLDS.map((w) => signIn(w).length);
    expect(Math.max(...counts)).toBeGreaterThan(50);
  });
});

/** A fixed order: each event's effects are done before the next event (no interleaving inside). */
function play(events: readonly AuthEvent[], from: AuthModel = initialAuthModel): { model: AuthModel; effects: AuthEffect[] } {
  let model = from;
  const effects: AuthEffect[] = [];
  for (const event of events) {
    const step = reduce(model, event);
    model = step.model;
    effects.push(...step.effects);
  }
  return { model, effects };
}

const types = (effects: readonly AuthEffect[]) => effects.map((e) => e.type);

describe("the auth machine, the orders that broke", () => {
  // e1a4d636f: restore emitted the stored token, adoptSession's /me ran beside the boot, failed offline after the
  // stored person was let in, and wrote nobody over them: the offline relaunch opened sign-in.
  it("an offline relaunch: the session's own emit at restore, then /me failing after the stored person is in", () => {
    const { model, effects } = play([
      { type: "bootStarted" },
      { type: "sessionEmitted", token: true },
      { type: "storedPersonRead", hasCredential: true, lastUser: STORED, sessionEnded: false },
      { type: "cacheRestored", user: STORED, for: ["stored"], sessionEnded: false, sessionsEnded: 0 },
      { type: "meAnswered", user: null, sessionEnded: false, sessionsEnded: 0 },
    ]);
    expect(model).toMatchObject({ user: STORED, isLoading: false, status: "signedInOffline", adoption: "idle", me: null });
    // One /me for the adoption and the revalidation, and nothing wiped.
    expect(types(effects).filter((t) => t === "loadMe")).toHaveLength(1);
    expect(effects.some((e) => WIPES.has(e.type))).toBe(false);
  });

  // 3b141d5e6: a verdict landed while the stored person's cached rooms were read; the boot let them in anyway.
  it("a verdict while the cached rooms are read lets nobody in and wipes", () => {
    const { model, effects } = play([
      { type: "bootStarted" },
      { type: "storedPersonRead", hasCredential: true, lastUser: STORED, sessionEnded: false },
      { type: "sessionEmitted", token: false },
      { type: "cacheRestored", user: STORED, for: ["stored"], sessionEnded: true, sessionsEnded: 0 },
      { type: "wiped" },
    ]);
    expect(model).toMatchObject({ user: null, isLoading: false, status: "signedOut" });
    expect(types(effects)).toContain("wipeAccount");
  });

  // aebaf4de1: the restore-time refresh was refused while the rest was read; onChange(null) found nobody to sign out.
  it("a verdict during the boot's reads opens nothing and wipes what the last person left", () => {
    const { model, effects } = play([
      { type: "bootStarted" },
      { type: "sessionEmitted", token: false },
      { type: "storedPersonRead", hasCredential: true, lastUser: STORED, sessionEnded: true },
      { type: "wiped" },
    ]);
    expect(model).toMatchObject({ user: null, isLoading: false, status: "signedOut" });
    expect(effects).toContainEqual({ type: "wipeLeftovers", lastUser: STORED });
    expect(types(effects)).not.toContain("loadMe");
  });

  // f077d212e: login() and the session's onChange both adopted the user, and two cache restores raced.
  it("login() and the session's emit share one /me and one cache restore", () => {
    const { model, effects } = play(
      [
        { type: "loginStarted" },
        { type: "sessionEmitted", token: true },
        { type: "loginCompleted", signedIn: true },
        { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
        { type: "cacheRestored", user: FRESH, for: ["adopt"], sessionEnded: false, sessionsEnded: 0 },
      ],
      { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" },
    );
    expect(types(effects).filter((t) => t === "loadMe")).toHaveLength(1);
    expect(types(effects).filter((t) => t === "restoreCache")).toHaveLength(1);
    expect(model).toMatchObject({ user: FRESH, status: "signedIn", adoption: "idle" });

    // login() settling while the emit's adoption already restores the cache joins it, never starts a second.
    const late = play(
      [
        { type: "sessionEmitted", token: true },
        { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
        { type: "loginCompleted", signedIn: true },
        { type: "cacheRestored", user: FRESH, for: ["adopt"], sessionEnded: false, sessionsEnded: 0 },
      ],
      { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" },
    );
    expect(types(late.effects).filter((t) => t === "loadMe")).toHaveLength(1);
    expect(types(late.effects).filter((t) => t === "restoreCache")).toHaveLength(1);
    expect(late.model).toMatchObject({ user: FRESH, adoption: "idle", me: null });
  });

  it("a sign-in's /me answered after the server ended the session lets nobody in", () => {
    const signedOut: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" };
    const { model, effects } = play(
      [
        { type: "sessionEmitted", token: true },
        { type: "sessionEmitted", token: false },
        { type: "meAnswered", user: FRESH, sessionEnded: true, sessionsEnded: 0 },
      ],
      signedOut,
    );
    expect(model).toMatchObject({ user: null, adoption: "idle" });
    expect(types(effects)).not.toContain("restoreCache");
  });

  it("a sign-out while a sign-in's /me is on the wire: the late answer lets nobody back in", () => {
    const signedIn: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" };
    const { model } = play(
      [
        { type: "loginStarted" },
        { type: "loginCompleted", signedIn: true },
        { type: "logout" },
        { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
      ],
      signedIn,
    );
    expect(model.user).toBeNull();
  });

  // A sign-in's (or a first start's) cache restore that the server's verdict overtook: nobody is let in, and the rooms
  // it hydrated go with a full wipe, or the next person's restore would write them into their own copy.
  it("a verdict while a sign-in's cache restore runs lets nobody in and wipes the rooms it hydrated", () => {
    const signIn = play(
      [
        { type: "sessionEmitted", token: true },
        { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
        { type: "sessionEmitted", token: false },
      ],
      SIGNED_OUT,
    );
    const restored = reduce(signIn.model, { type: "cacheRestored", user: FRESH, for: ["adopt"], sessionEnded: true, sessionsEnded: 0 });
    expect([...signIn.effects, ...restored.effects].filter((e) => e.type === "wipeAccount")).toHaveLength(1);
    expect(restored.model).toMatchObject({ user: null, adoption: "idle" });
    expect(reduce(restored.model, { type: "wiped" }).model.status).toBe("signedOut");

    // The restore read the session signed out before any emit reached the store: refused and wiped all the same.
    const unheard = play(
      [
        { type: "sessionEmitted", token: true },
        { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
        { type: "cacheRestored", user: FRESH, for: ["adopt"], sessionEnded: true, sessionsEnded: 0 },
      ],
      SIGNED_OUT,
    );
    expect(unheard.model).toMatchObject({ user: null, adoption: "idle", status: "signingOut" });
    expect(types(unheard.effects)).toContain("wipeAccount");

    const firstStart = play([
      { type: "bootStarted" },
      { type: "storedPersonRead", hasCredential: true, lastUser: null, sessionEnded: false },
      { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
      { type: "sessionEmitted", token: false },
      { type: "cacheRestored", user: FRESH, for: ["boot"], sessionEnded: true, sessionsEnded: 0 },
    ]);
    expect(types(firstStart.effects)).toContain("wipeAccount");
    expect(firstStart.model.user).toBeNull();
  });

  // Sign in with Apple (ADR 0041) is the same sign-in with another first step: the method rides to the effect.
  it("a sign-in names its method; the browser is the default", () => {
    expect(reduce(SIGNED_OUT, { type: "loginStarted", method: "apple" }).effects).toEqual([{ type: "sessionLogin", method: "apple" }]);
    expect(reduce(SIGNED_OUT, { type: "loginStarted" }).effects).toEqual([{ type: "sessionLogin", method: "browser" }]);
  });

  // A sign-in after a sign-out asks /me again: the old session's /me, still on the wire, answers for the old person.
  it("a sign-in after a sign-out while the old session's /me is on the wire asks /me again and ignores the late answer", () => {
    const offline: AuthModel = { ...SIGNED_OUT, user: STORED, status: "signedInOffline", me: { boot: false, adopt: false, revalidate: true } };
    const out = play([{ type: "sessionEmitted", token: false }, { type: "logout" }, { type: "wiped" }, { type: "loginStarted" }], offline);
    const login = reduce(out.model, { type: "loginCompleted", signedIn: true });
    const ask = login.effects.find((e) => e.type === "loadMe");
    expect(ask, "loginCompleted asks /me").toBeDefined();
    const late = reduce(login.model, { type: "meAnswered", user: STORED, sessionEnded: false, sessionsEnded: 0 });
    expect(late.effects).toEqual([]);
    expect(late.model).toMatchObject({ adoption: "awaitingMe", user: null });
    const answer = reduce(late.model, { type: "meAnswered", user: NEXT, sessionEnded: false, sessionsEnded: ask!.type === "loadMe" ? ask!.sessionsEnded : -1 });
    expect(answer.effects).toContainEqual({ type: "restoreCache", user: NEXT, for: ["adopt"], sessionsEnded: login.model.sessionsEnded });
  });

  it("a verdict with someone in asks the app to sign out; an explicit sign-out wipes and reports nobody", () => {
    const inside: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, user: STORED, confirmed: true, status: "signedIn" };
    expect(types(reduce(inside, { type: "sessionEmitted", token: false }).effects)).toEqual(["requestSignOut"]);
    const out = reduce(inside, { type: "logout" });
    expect(out.model).toMatchObject({ user: null, status: "signingOut" });
    expect(types(out.effects)).toEqual(["reportUser", "dropPushSubscription", "endSession", "wipeAccount"]);
    expect(reduce(out.model, { type: "wiped" }).model.status).toBe("signedOut");
  });

  it("an account deletion forgets the push token without a call, ends the session and wipes the device", () => {
    const inside: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, user: STORED, confirmed: true, status: "signedIn" };
    const out = reduce(inside, { type: "accountDeleted", workspaceIds: ["w1"] });
    expect(types(out.effects)).toEqual(["reportUser", "forgetPushToken", "endSession", "wipeAccount", "wipeDevice"]);
    expect(out.effects.at(-1)).toEqual({ type: "wipeDevice", workspaceIds: ["w1"] });
  });

  it("the revalidation /me replaces the stored profile only with the same person's", () => {
    const offline: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, user: STORED, status: "signedInOffline", me: { boot: false, adopt: false, revalidate: true } };
    expect(reduce(offline, { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 }).model).toMatchObject({ user: FRESH, status: "signedIn" });
    expect(reduce(offline, { type: "meAnswered", user: person("u2"), sessionEnded: false, sessionsEnded: 0 }).model.user).toBe(STORED);
    expect(reduce(offline, { type: "meAnswered", user: null, sessionEnded: false, sessionsEnded: 0 }).model).toMatchObject({ user: STORED, status: "signedInOffline" });
  });

  it("an answer no stage waits for changes nothing (a second boot's reads, a /me nobody joined, a stale cache read)", () => {
    const inside: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, user: STORED, confirmed: true, status: "signedIn" };
    expect(reduce(inside, { type: "storedPersonRead", hasCredential: true, lastUser: STORED, sessionEnded: false })).toEqual({ model: inside, effects: [] });
    expect(reduce(inside, { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 })).toEqual({ model: inside, effects: [] });
    expect(reduce(inside, { type: "cacheRestored", user: FRESH, for: ["stored", "boot", "adopt"], sessionEnded: false, sessionsEnded: 0 })).toEqual({ model: inside, effects: [] });
  });

  // The restore's own emit starts an adoption beside the cold start; the stored person is let in first, and the
  // server ends the session before the adoption's cached rooms land. Those rooms are the person's in, so the refused
  // restore wipes nothing: the session's end signs them out, and the sign-out wipes.
  it("a sign-in's cache restore refused while the stored person is in leaves them in and wipes nothing", () => {
    const { model, effects } = play([
      { type: "bootStarted" },
      { type: "storedPersonRead", hasCredential: true, lastUser: STORED, sessionEnded: false },
      { type: "sessionEmitted", token: true },
      { type: "meAnswered", user: FRESH, sessionEnded: false, sessionsEnded: 0 },
      { type: "cacheRestored", user: STORED, for: ["stored"], sessionEnded: false, sessionsEnded: 0 },
      { type: "cacheRestored", user: FRESH, for: ["adopt"], sessionEnded: true, sessionsEnded: 0 },
    ]);
    expect(model).toMatchObject({ user: STORED, adoption: "idle", sessionEnded: true, wiping: 0 });
    expect(effects.some((e) => WIPES.has(e.type))).toBe(false);
    expect(reduce(model, { type: "sessionEmitted", token: false }).effects).toContainEqual({ type: "requestSignOut" });
  });

  it("a profile update replaces the person and is remembered; the crash reporter hears only id changes", () => {
    const inside: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, user: STORED, confirmed: true, status: "signedIn" };
    expect(types(reduce(inside, { type: "profileUpdated", user: FRESH }).effects)).toEqual(["rememberProfile"]);
    const signedOut: AuthModel = { ...initialAuthModel, boot: "idle", isLoading: false, status: "signedOut" };
    expect(reduce(signedOut, { type: "profileUpdated", user: FRESH }).effects).toEqual([
      { type: "reportUser", userId: "u1" },
      { type: "rememberProfile", user: FRESH },
    ]);
  });
});
