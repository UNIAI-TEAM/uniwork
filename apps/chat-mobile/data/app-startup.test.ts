import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  startUpdatesController: vi.fn(),
  startAnalytics: vi.fn(),
  track: vi.fn(),
  persistRemoteConfig: vi.fn(),
  restoreRemoteConfig: vi.fn(),
  crumbs: [] as string[],
  user: null as { id: string } | null,
  setUser: vi.fn(),
  subscribe: vi.fn(),
  setLocale: vi.fn(),
  startLocaleSync: vi.fn(),
  dismissRoomNotifications: vi.fn<(roomId: string) => Promise<number>>(async () => 1),
  reportLaunchHealth: vi.fn<() => Promise<void>>(async () => undefined),
}));

vi.mock("./updates-controller", () => ({ startUpdatesController: calls.startUpdatesController }));
// pushOpenResult is analytics.ts's (tested there); here it only has to be the one asked.
vi.mock("./analytics", () => ({
  pushOpenResult: (data: unknown) => (data === undefined ? "other" : "call"),
  startAnalytics: calls.startAnalytics,
  track: calls.track,
}));
vi.mock("./remote-config", () => ({ persistRemoteConfig: calls.persistRemoteConfig, restoreRemoteConfig: calls.restoreRemoteConfig }));
vi.mock("./auth/store", () => ({ useAuthStore: { getState: () => ({ user: calls.user, setUser: calls.setUser }), subscribe: calls.subscribe } }));
vi.mock("./account-api", () => ({ accountApi: { setLocale: calls.setLocale } }));
vi.mock("./locale-sync", () => ({ startLocaleSync: calls.startLocaleSync }));
vi.mock("./notification-tray", () => ({ dismissRoomNotifications: calls.dismissRoomNotifications }));
vi.mock("./release/launch-health", () => ({ reportLaunchHealth: calls.reportLaunchHealth }));
vi.mock("./storage/device-store", () => ({ openDeviceStore: vi.fn() }));
vi.mock("./report", () => ({ bestEffort: (_scope: string, what: string) => () => void calls.crumbs.push(what) }));

import type { QueryClient } from "@tanstack/react-query";
import type { User } from "@uniwork/core/types/user";
import { i18n } from "@/lib/i18n/singleton";
import type { LocaleSyncDeps } from "./locale-sync";
import { roomWasRead } from "./room-read-signal";
import { openDeviceStore } from "./storage/device-store";

const loadedAt = Date.now();
const { startAppServices, trackFirstScreen, trackPushOpen } = await import("./app-startup");

beforeEach(() => {
  vi.clearAllMocks();
  calls.crumbs.splice(0);
});

describe("startAppServices", () => {
  it("starts the OTA controller, the counters (signed in only with a user) and the kept remote config", async () => {
    const queryClient = {} as QueryClient;
    const usageStatsEnabled = () => true;
    calls.restoreRemoteConfig.mockRejectedValueOnce(new Error("locked"));
    startAppServices({ queryClient, usageStatsEnabled });
    expect(calls.startUpdatesController).toHaveBeenCalledTimes(1);
    const [{ enabled, signedIn }] = calls.startAnalytics.mock.calls[0] as [{ enabled: () => boolean; signedIn: () => boolean }];
    expect(enabled).toBe(usageStatsEnabled);
    expect(signedIn()).toBe(false);
    calls.user = { id: "u1" };
    expect(signedIn()).toBe(true);
    expect(calls.persistRemoteConfig).toHaveBeenCalledWith(queryClient, openDeviceStore);
    expect(calls.restoreRemoteConfig).toHaveBeenCalledWith(queryClient, openDeviceStore);
    await vi.waitFor(() => expect(calls.crumbs).toEqual(["kept answer not read"]));
  });

  it("tells how the launch went, and a launch report that fails is only a breadcrumb", async () => {
    calls.restoreRemoteConfig.mockResolvedValueOnce(true);
    calls.reportLaunchHealth.mockRejectedValueOnce(new Error("store locked"));
    startAppServices({ queryClient: {} as QueryClient, usageStatsEnabled: () => true });
    expect(calls.reportLaunchHealth).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(calls.crumbs).toEqual(["launch health not told"]));
  });

  it("takes a read room's notifications out of the tray, and a tray that fails is only a breadcrumb", async () => {
    calls.restoreRemoteConfig.mockResolvedValueOnce(true);
    startAppServices({ queryClient: {} as QueryClient, usageStatsEnabled: () => true });
    roomWasRead("r1");
    expect(calls.dismissRoomNotifications).toHaveBeenCalledWith("r1");
    calls.dismissRoomNotifications.mockRejectedValueOnce(new Error("no tray"));
    roomWasRead("r2");
    await vi.waitFor(() => expect(calls.crumbs).toContain("read room's notifications not dismissed"));
  });

  it("sends the app's language to the server for the signed-in person", async () => {
    calls.restoreRemoteConfig.mockResolvedValueOnce(true);
    startAppServices({ queryClient: {} as QueryClient, usageStatsEnabled: () => true });
    const [deps] = calls.startLocaleSync.mock.calls[0] as [LocaleSyncDeps];
    calls.user = { id: "u1" };
    expect(deps.getUser()).toEqual({ id: "u1" });
    expect(deps.openStore).toBe(openDeviceStore);
    // A change of person (not any store change) wakes the sync.
    const wake = vi.fn();
    deps.subscribeUser(wake);
    const [onChange] = calls.subscribe.mock.calls[0] as [(state: { user: unknown }, previous: { user: unknown }) => void];
    onChange({ user: calls.user }, { user: calls.user });
    expect(wake).not.toHaveBeenCalled();
    onChange({ user: null }, { user: calls.user });
    expect(wake).toHaveBeenCalledTimes(1);
    // The app's language, vi unless it is en, and its changes.
    await i18n.changeLanguage("en");
    expect(deps.getLocale()).toBe("en");
    const heard = vi.fn();
    const stop = deps.subscribeLocale(heard);
    await i18n.changeLanguage("vi");
    expect(deps.getLocale()).toBe("vi");
    stop();
    await i18n.changeLanguage("en");
    expect(heard).toHaveBeenCalledTimes(1);
    await i18n.changeLanguage("vi");
    const updated = { id: "u1", locale: "en" } as unknown as User;
    calls.setLocale.mockResolvedValueOnce(updated);
    await expect(deps.patchLocale("en")).resolves.toBe(updated);
    deps.setUser(updated);
    expect(calls.setUser).toHaveBeenCalledWith(updated);
  });
});

describe("trackFirstScreen / trackPushOpen", () => {
  it("counts the first screen once, from when the module loaded, and a push open by what it was about", () => {
    trackFirstScreen(loadedAt + 1_500);
    trackFirstScreen(loadedAt + 9_000);
    expect(calls.track).toHaveBeenCalledTimes(1);
    const [[event]] = calls.track.mock.calls as [[{ name: string; duration_ms: number }]];
    expect(event.name).toBe("first_screen");
    expect(event.duration_ms).toBeGreaterThanOrEqual(1_400);
    expect(event.duration_ms).toBeLessThanOrEqual(1_500);
    trackPushOpen({ call_id: "c1", room_id: "r1" });
    trackPushOpen(undefined);
    expect(calls.track.mock.calls.slice(1).map(([e]) => e)).toEqual([
      { name: "push_open", result: "call" },
      { name: "push_open", result: "other" },
    ]);
  });

  it("defaults the first screen's clock to now", async () => {
    vi.resetModules();
    const fresh = await import("./app-startup");
    fresh.trackFirstScreen();
    const [[event]] = calls.track.mock.calls as [[{ duration_ms: number }]];
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
