// A chat push read into the cache by the background task of a closed app (push-prefetch.ts, review
// "no-background-sync-from-push"): the room's newest page and its list read and saved at once; nothing for a push
// that is not a chat message, a phone signed out, or an app on screen (its listener reads it); bounded by a budget
// whose end still saves what landed; never throwing into the task. Then the app's env: a headless runtime boots,
// opens the store, installs and restores the person's copy only where no screen did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  bootRuntime: vi.fn(),
  session: { status: vi.fn(() => "signed-in"), restore: vi.fn(async () => true) },
  readLastUser: vi.fn(async () => ({ id: "me" }) as { id: string } | null),
  storeInstalled: true,
  installDeviceStore: vi.fn(),
  cacheInstalled: true,
  cacheUser: "me" as string | null,
  installAccountCache: vi.fn(),
  createDevicePersister: vi.fn(() => "persister"),
  restoreAccountCache: vi.fn(async () => undefined),
  saveAccountCacheNow: vi.fn(async () => undefined),
  hydrateRoom: vi.fn(async () => undefined),
  appState: "background",
}));
vi.mock("react-native", () => ({ AppState: { get currentState() { return deps.appState; } } }));
vi.mock("../boot", () => ({ bootRuntime: deps.bootRuntime }));
vi.mock("../auth/flow", () => ({ session: deps.session }));
vi.mock("../auth/last-user", () => ({ readLastUser: deps.readLastUser }));
vi.mock("../query-client", () => ({ queryClient: { tag: "qc" } }));
vi.mock("../query-persister", () => ({
  accountCacheInstalled: () => deps.cacheInstalled,
  accountCacheUser: () => deps.cacheUser,
  createDevicePersister: deps.createDevicePersister,
  installAccountCache: deps.installAccountCache,
  restoreAccountCache: deps.restoreAccountCache,
  saveAccountCacheNow: deps.saveAccountCacheNow,
}));
vi.mock("../storage/device-store", () => ({
  deviceStoreInstalled: () => deps.storeInstalled,
  installDeviceStore: deps.installDeviceStore,
  openDeviceStore: "device-opener",
}));
vi.mock("../storage/native-device-store", () => ({ openNativeDeviceStore: "native-opener" }));
vi.mock("../timeline-refresh", () => ({ hydrateRoom: deps.hydrateRoom }));

import { installReportSink } from "../report";
import { PUSH_PREFETCH_BUDGET_MS, appPushPrefetchEnv, prefetchChatPush, type PushPrefetchEnv } from "./push-prefetch";

const chat = { workspace_id: "w", room_id: "r", message_id: "m", url: "https://app.test/o/w/chat?room=r" };

function fakeEnv(over: Partial<PushPrefetchEnv> = {}): PushPrefetchEnv & { [K in "prepare" | "read" | "save"]: ReturnType<typeof vi.fn> } {
  return {
    inFront: () => false,
    prepare: vi.fn(async () => true),
    read: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    budgetMs: 1_000,
    ...over,
  } as PushPrefetchEnv & { [K in "prepare" | "read" | "save"]: ReturnType<typeof vi.fn> };
}

const breadcrumbs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  breadcrumbs.length = 0;
  installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
  Object.assign(deps, { storeInstalled: true, cacheInstalled: true, cacheUser: "me", appState: "background" });
  deps.session.status.mockReturnValue("signed-in");
  deps.readLastUser.mockResolvedValue({ id: "me" });
});
afterEach(() => {
  installReportSink(null);
  vi.useRealTimers();
});

describe("a chat push read into the cache of a closed app", () => {
  it("reads the room's newest page and its list, then saves at once", async () => {
    const env = fakeEnv();
    await expect(prefetchChatPush(chat, env)).resolves.toBe("prefetched");
    expect(env.read).toHaveBeenCalledWith("w", "r");
    expect(env.save).toHaveBeenCalledTimes(1);
    expect(env.save.mock.invocationCallOrder[0]).toBeGreaterThan(env.read.mock.invocationCallOrder[0]!);
  });

  it("does nothing for a push that is not a chat message, or while the app is on screen", async () => {
    const env = fakeEnv();
    await expect(prefetchChatPush({ type: "call_invite", call_id: "c", room_id: "r", workspace_id: "w", message_id: "m" }, env)).resolves.toBe("not-chat");
    await expect(prefetchChatPush(null, env)).resolves.toBe("not-chat");
    const front = fakeEnv({ inFront: () => true });
    // The running app's notification listener reads it (use-account-sync.ts › hydrateFromPush).
    await expect(prefetchChatPush(chat, front)).resolves.toBe("in-app");
    expect([...env.prepare.mock.calls, ...front.prepare.mock.calls]).toEqual([]);
  });

  it("reads nothing and saves nothing for a phone signed out", async () => {
    const env = fakeEnv({ prepare: vi.fn(async () => false) });
    await expect(prefetchChatPush(chat, env)).resolves.toBe("signed-out");
    expect(env.read).not.toHaveBeenCalled();
    expect(env.save).not.toHaveBeenCalled();
  });

  it("lets go when the budget runs out, keeping what landed; a late failure is only a breadcrumb", async () => {
    vi.useFakeTimers();
    let fail: (error: Error) => void = () => undefined;
    const env = fakeEnv({ read: vi.fn(() => new Promise<void>((_, reject) => (fail = reject))) });
    const outcome = prefetchChatPush(chat, env);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toBe("timeout");
    expect(env.save).toHaveBeenCalledTimes(1);
    fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(breadcrumbs).toContain("chat push not read into the cache");
  });

  it("never throws into the task: a failure is a breadcrumb, and what landed is still saved", async () => {
    const env = fakeEnv({ prepare: vi.fn(async () => Promise.reject(new Error("keychain"))) });
    await expect(prefetchChatPush(chat, env)).resolves.toBe("failed");
    expect(env.save).toHaveBeenCalledTimes(1);
    expect(breadcrumbs).toContain("chat push not read into the cache");
  });
});

describe("the app's env", () => {
  it("in a running app, reads with what the screens set up: nothing installed or restored again", async () => {
    await expect(appPushPrefetchEnv.prepare()).resolves.toBe(true);
    expect(deps.bootRuntime).toHaveBeenCalled();
    expect(deps.installDeviceStore).not.toHaveBeenCalled();
    expect(deps.installAccountCache).not.toHaveBeenCalled();
    expect(deps.restoreAccountCache).not.toHaveBeenCalled();
    await appPushPrefetchEnv.read("w", "r");
    expect(deps.hydrateRoom).toHaveBeenCalledWith({ tag: "qc" }, "w", "r");
    await appPushPrefetchEnv.save();
    expect(deps.saveAccountCacheNow).toHaveBeenCalledTimes(1);
    expect(appPushPrefetchEnv.inFront()).toBe(false);
    deps.appState = "active";
    expect(appPushPrefetchEnv.inFront()).toBe(true);
    expect(appPushPrefetchEnv.budgetMs).toBe(PUSH_PREFETCH_BUDGET_MS);
  });

  it("in a headless runtime, opens the encrypted store, installs the cache and restores the person's copy first", async () => {
    Object.assign(deps, { storeInstalled: false, cacheInstalled: false, cacheUser: null });
    deps.session.status.mockReturnValue("signed-out");
    await expect(appPushPrefetchEnv.prepare()).resolves.toBe(true);
    expect(deps.installDeviceStore).toHaveBeenCalledWith("native-opener");
    expect(deps.createDevicePersister).toHaveBeenCalledWith("device-opener");
    expect(deps.installAccountCache).toHaveBeenCalledWith({ queryClient: { tag: "qc" }, persister: "persister" });
    expect(deps.session.restore).toHaveBeenCalled();
    expect(deps.restoreAccountCache).toHaveBeenCalledWith("me");
  });

  it("is signed out when the session will not restore or no person is kept", async () => {
    deps.session.status.mockReturnValue("signed-out");
    deps.session.restore.mockResolvedValueOnce(false);
    await expect(appPushPrefetchEnv.prepare()).resolves.toBe(false);
    deps.session.status.mockReturnValue("signed-in");
    deps.readLastUser.mockResolvedValueOnce(null);
    await expect(appPushPrefetchEnv.prepare()).resolves.toBe(false);
  });
});
