import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}));
const appState = vi.hoisted(() => ({ currentState: "active", listener: null as ((state: string) => void) | null, remove: vi.fn() }));
const call = vi.hoisted(() => ({ status: "idle" }));
const crumbs = vi.hoisted(() => [] as { message: string; data?: Record<string, unknown> }[]);

vi.mock("expo-updates", () => updates);
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: appState.remove };
    },
  },
}));
vi.mock("./calls/call-store", () => ({ callEngine: { store: { getState: () => ({ call }) } } }));
vi.mock("./report", async (original) => ({
  ...(await original<typeof import("./report")>()),
  breadcrumb: (_category: string, message: string, _level: string, data?: Record<string, unknown>) => crumbs.push({ message, data }),
}));

import {
  APPLY_AFTER_AWAY_MS,
  APPLY_ON_RETURN_MS,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  createUpdatesController,
  isCriticalManifest,
  startUpdatesController,
  type UpdatesController,
  type UpdatesControllerDeps,
} from "./updates-controller";

const criticalManifest = { extra: { expoClient: { extra: { criticalUpdate: true } } } };

function harness(overrides: Partial<UpdatesControllerDeps> = {}) {
  let now = 1_000_000;
  const deps = {
    enabled: true,
    check: vi.fn(async () => ({ isAvailable: true, manifest: criticalManifest })),
    fetch: vi.fn(async () => ({ isNew: true, manifest: criticalManifest })),
    reload: vi.fn(async () => undefined),
    callActive: vi.fn(() => false),
    systemUiOpen: vi.fn(() => false),
    inBackground: vi.fn(() => true),
    now: () => now,
    ...overrides,
  };
  const controller = createUpdatesController(deps);
  return { deps, controller, advance: (ms: number) => void (now += ms) };
}

beforeEach(() => void crumbs.splice(0));
afterEach(() => void vi.useRealTimers());

/** A trip to the background long enough for a critical update to be applied there. */
async function away(controller: UpdatesController) {
  await controller.onBackground();
  await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS);
}

describe("isCriticalManifest", () => {
  it("reads extra.expoClient.extra.criticalUpdate, and nothing else", () => {
    expect(isCriticalManifest(criticalManifest)).toBe(true);
    expect(isCriticalManifest({ extra: { expoClient: { extra: { criticalUpdate: "yes" } } } })).toBe(false);
    expect(isCriticalManifest({ extra: { expoClient: {} } })).toBe(false);
    expect(isCriticalManifest({ extra: null })).toBe(false);
    expect(isCriticalManifest(undefined)).toBe(false);
  });
});

describe("createUpdatesController", () => {
  it("leaves the launch to expo-updates, then checks a minute in and at most every 30 minutes", async () => {
    const { deps, controller, advance } = harness({ check: vi.fn(async () => ({ isAvailable: false })) });
    await controller.onActive();
    expect(deps.check).not.toHaveBeenCalled();
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(crumbs.map((c) => c.message)).toEqual(["no update"]);
    advance(CHECK_INTERVAL_MS - 1);
    await controller.onActive();
    expect(deps.check).toHaveBeenCalledTimes(1);
    advance(1);
    await controller.onActive();
    expect(deps.check).toHaveBeenCalledTimes(2);
  });

  it("does nothing where expo-updates is off", async () => {
    const { deps, controller, advance } = harness({ enabled: false });
    advance(CHECK_INTERVAL_MS);
    await controller.onActive();
    await controller.onBackground();
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("asks once while a check is under way", async () => {
    let finish: (value: { isAvailable: boolean }) => void = () => undefined;
    const check = vi.fn(() => new Promise<{ isAvailable: boolean }>((resolve) => (finish = resolve)));
    const { controller, advance } = harness({ check });
    advance(CHECK_INTERVAL_MS);
    const first = controller.onActive();
    advance(CHECK_INTERVAL_MS);
    await controller.onActive();
    finish({ isAvailable: false });
    await first;
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("applies a critical update once the app has stayed in the background a minute, once", async () => {
    vi.useFakeTimers();
    const { deps, controller, advance } = harness();
    await away(controller);
    expect(deps.reload).not.toHaveBeenCalled();
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    expect(crumbs.at(-1)).toEqual({ message: "update downloaded", data: { critical: true, isNew: true } });
    expect(deps.reload).not.toHaveBeenCalled();
    await controller.onBackground();
    await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS - 1);
    expect(deps.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(crumbs.at(-1)?.message).toBe("applying critical update");
    await away(controller);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads on a quick trip out: the sign-in tab, a picker or a permission prompt the app opened", async () => {
    vi.useFakeTimers();
    const systemUiOpen = vi.fn(() => false);
    const { deps, controller, advance } = harness({ systemUiOpen });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    // Back from the Custom Tab or the picker within the minute: nothing happens.
    await controller.onBackground();
    await controller.onBackground();
    await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS - 1_000);
    advance(APPLY_AFTER_AWAY_MS - 1_000);
    await controller.onActive();
    await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS);
    expect(deps.reload).not.toHaveBeenCalled();
    // A system screen the app waits on is still up after the minute (a long sign-in): it waits for the next trip.
    systemUiOpen.mockReturnValue(true);
    await away(controller);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(crumbs.at(-1)?.message).toBe("critical update waits for the system screen");
    systemUiOpen.mockReturnValue(false);
    await controller.onActive();
    await away(controller);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("applies on the return from a long absence when the OS froze it in the background, not after a short one", async () => {
    vi.useFakeTimers();
    const inBackground = vi.fn(() => false);
    const { deps, controller, advance } = harness({ inBackground });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    // iOS froze JS: the timer fires late, on the way back, and leaves it to onActive.
    await away(controller);
    advance(APPLY_ON_RETURN_MS - 1);
    await controller.onActive();
    expect(deps.reload).not.toHaveBeenCalled();
    await away(controller);
    advance(APPLY_ON_RETURN_MS);
    await controller.onActive();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.check).toHaveBeenCalledTimes(1);
  });

  it("never reloads under a call: the update waits for the next trip to the background", async () => {
    vi.useFakeTimers();
    const callActive = vi.fn(() => true);
    const { deps, controller, advance } = harness({ callActive });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    await away(controller);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(crumbs.at(-1)?.message).toBe("critical update waits for the call");
    // A long absence under a call: the return does not reload either, and the usual check goes on.
    advance(APPLY_ON_RETURN_MS + CHECK_INTERVAL_MS);
    await controller.onActive();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(deps.check).toHaveBeenCalledTimes(2);
    callActive.mockReturnValue(false);
    await away(controller);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain update for the next cold start, and reads the check's manifest when the fetch has none", async () => {
    vi.useFakeTimers();
    const { deps, controller, advance } = harness({
      check: vi.fn(async () => ({ isAvailable: true, manifest: { extra: {} } })),
      fetch: vi.fn(async () => ({ isNew: false })),
    });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    await away(controller);
    expect(deps.reload).not.toHaveBeenCalled();
    expect(crumbs.at(-1)).toEqual({ message: "update downloaded", data: { critical: false, isNew: false } });
  });

  it.each([
    ["the check", { isAvailable: false, isRollBackToEmbedded: true }, { isNew: false }],
    ["the fetch", { isAvailable: true }, { isNew: true, isRollBackToEmbedded: true }],
  ])("treats a roll-back-to-embedded directive from %s as critical", async (_where, found, fetched) => {
    vi.useFakeTimers();
    const { deps, controller, advance } = harness({ check: vi.fn(async () => found), fetch: vi.fn(async () => fetched) });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    await away(controller);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed check or reload to a breadcrumb", async () => {
    vi.useFakeTimers();
    const { controller, advance } = harness({ check: vi.fn(async () => Promise.reject(new Error("Network request failed"))) });
    advance(FIRST_CHECK_DELAY_MS);
    await controller.onActive();
    expect(crumbs.at(-1)).toEqual({ message: "update check failed", data: { reason: "Network request failed" } });

    const failing = harness({ reload: vi.fn(async () => Promise.reject("busy")) });
    failing.advance(FIRST_CHECK_DELAY_MS);
    await failing.controller.onActive();
    await away(failing.controller);
    expect(crumbs.at(-1)).toEqual({ message: "critical update reload failed", data: { reason: "busy" } });
  });
});

describe("startUpdatesController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    updates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, manifest: criticalManifest });
    updates.fetchUpdateAsync.mockResolvedValue({ isNew: true, manifest: criticalManifest });
    updates.reloadAsync.mockResolvedValue(undefined);
    appState.currentState = "active";
    call.status = "idle";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("checks a minute after launch while open, and applies a critical update a minute into the background unless a call is on", async () => {
    const stop = startUpdatesController();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    call.status = "active";
    appState.currentState = "background";
    appState.listener?.("background");
    await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    call.status = "ended";
    appState.currentState = "active";
    appState.listener?.("active");
    appState.listener?.("inactive");
    appState.currentState = "background";
    appState.listener?.("background");
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(APPLY_AFTER_AWAY_MS);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
    appState.currentState = "active";
    vi.setSystemTime(Date.now() + CHECK_INTERVAL_MS);
    appState.listener?.("active");
    await vi.advanceTimersByTimeAsync(0);
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
    stop();
    expect(appState.remove).toHaveBeenCalled();
  });

  it("skips the first check while the app is in the background, and stops its timer when stopped", async () => {
    appState.currentState = "background";
    startUpdatesController()();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    const stillOpen = startUpdatesController();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
    stillOpen();
  });

  it("is off in a development build", async () => {
    vi.stubGlobal("__DEV__", true);
    const stop = startUpdatesController();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
    stop();
    vi.unstubAllGlobals();
  });
});
