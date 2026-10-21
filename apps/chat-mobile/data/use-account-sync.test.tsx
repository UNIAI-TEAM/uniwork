// The signed-in app keeps in step whatever screen is open: the outbox goes once the session is ready,
// on the network's offline → online edge, on every return to the front and as the app leaves it; the stale rooms are read
// as the app leaves; a push about a room reads it into the cache.
import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { configureRuntime } from "@uniwork/core/runtime-config";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { installReportSink } from "./report";
import { useAccountSync } from "./use-account-sync";

const mockFlushOwed = jest.fn(async () => undefined);
jest.mock("./owed", () => ({ flushOwed: (...args: unknown[]) => mockFlushOwed(...(args as [])) }));
const mockRefreshStale = jest.fn(async () => undefined);
const mockHydrate = jest.fn(async () => undefined);
jest.mock("./timeline-refresh", () => ({
  refreshStaleTimelines: (...args: unknown[]) => mockRefreshStale(...(args as [])),
  hydrateFromPush: (...args: unknown[]) => mockHydrate(...(args as [])),
}));
jest.mock("./auth/flow", () => ({ authConfig: { scheme: "uniworkchat" } }));

type PushListener = (event: unknown) => void;
const mockPush: { received: PushListener[]; tapped: PushListener[]; removed: number } = { received: [], tapped: [], removed: 0 };
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (listener: PushListener) => {
    mockPush.received.push(listener);
    return { remove: () => void (mockPush.removed += 1) };
  },
  addNotificationResponseReceivedListener: (listener: PushListener) => {
    mockPush.tapped.push(listener);
    return { remove: () => void (mockPush.removed += 1) };
  },
}));

type NetListener = (state: { isConnected: boolean | null }) => void;
const mockNet: { listeners: NetListener[]; unsubscribe: jest.Mock } = { listeners: [], unsubscribe: jest.fn() };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: NetListener) => {
      mockNet.listeners.push(listener);
      return mockNet.unsubscribe;
    },
  },
}));

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const push = (url: string) => ({ request: { content: { data: { url } } } });

beforeEach(() => {
  configureRuntime({ appUrl: "https://app.test" });
  mockFlushOwed.mockClear();
  mockRefreshStale.mockReset().mockResolvedValue(undefined);
  mockHydrate.mockReset().mockResolvedValue(undefined);
  mockNet.listeners = [];
  mockNet.unsubscribe.mockClear();
  mockPush.received = [];
  mockPush.tapped = [];
  mockPush.removed = 0;
});
afterEach(() => jest.restoreAllMocks());

it("does nothing until the session and the queues are read", async () => {
  await renderHook(() => useAccountSync(null), { wrapper });
  expect(mockFlushOwed).not.toHaveBeenCalled();
  expect(mockNet.listeners).toHaveLength(0);
  expect(mockPush.received).toHaveLength(0);
});

it("flushes once ready, on the offline → online edge only, and on each return to the front", async () => {
  let onAppState: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onAppState = listener as (state: string) => void;
    return { remove };
  });
  jest.spyOn(onlineManager, "isOnline").mockReturnValue(true);
  const { unmount } = await renderHook(() => useAccountSync("u1"), { wrapper });
  expect(mockFlushOwed).toHaveBeenCalledTimes(1);
  expect(mockFlushOwed).toHaveBeenLastCalledWith(queryClient, "u1");

  const net = mockNet.listeners[0]!;
  await act(async () => net({ isConnected: true }));
  expect(mockFlushOwed).toHaveBeenCalledTimes(1);
  await act(async () => net({ isConnected: false }));
  await act(async () => net({ isConnected: null }));
  await act(async () => net({ isConnected: true }));
  expect(mockFlushOwed).toHaveBeenCalledTimes(2);

  await act(async () => onAppState?.("inactive"));
  expect(mockFlushOwed).toHaveBeenCalledTimes(2);
  expect(mockRefreshStale).not.toHaveBeenCalled();
  await act(async () => onAppState?.("active"));
  expect(mockFlushOwed).toHaveBeenCalledTimes(3);
  // Leaving the front: what was written just before the switch goes while JS still runs (the socket's grace keeps the path warm).
  await act(async () => onAppState?.("background"));
  expect(mockFlushOwed).toHaveBeenCalledTimes(4);

  await unmount();
  expect(mockNet.unsubscribe).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mockPush.removed).toBe(2);
});

it("reads the stale rooms as the app leaves the front, online only, and a failure is reported, not thrown", async () => {
  let onAppState: ((state: string) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    onAppState = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
  const online = jest.spyOn(onlineManager, "isOnline").mockReturnValue(false);
  const breadcrumbs: string[] = [];
  installReportSink({ captureException: jest.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message), setUser: jest.fn(), setTag: jest.fn() });
  try {
    await renderHook(() => useAccountSync("u1"), { wrapper });
    await act(async () => onAppState?.("background"));
    expect(mockRefreshStale).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    mockRefreshStale.mockRejectedValueOnce(new Error("boom"));
    await act(async () => onAppState?.("background"));
    expect(mockRefreshStale).toHaveBeenCalledWith(queryClient);
    expect(breadcrumbs).toContain("stale rooms not refreshed");
  } finally {
    installReportSink(null);
  }
});

it("a push received in front or tapped is read into the cache; a failure is reported, not thrown", async () => {
  const breadcrumbs: string[] = [];
  installReportSink({ captureException: jest.fn(), addBreadcrumb: (b) => void breadcrumbs.push(b.message), setUser: jest.fn(), setTag: jest.fn() });
  try {
    await renderHook(() => useAccountSync("u1"), { wrapper });
    await act(async () => mockPush.received[0]!(push("https://app.test/o/w/chat?room=r1")));
    expect(mockHydrate).toHaveBeenLastCalledWith(queryClient, { url: "https://app.test/o/w/chat?room=r1" }, { appUrl: "https://app.test", scheme: "uniworkchat" });
    mockHydrate.mockRejectedValueOnce(new Error("boom"));
    await act(async () => mockPush.tapped[0]!({ notification: push("https://app.test/o/w/chat?room=r2") }));
    expect(mockHydrate).toHaveBeenCalledTimes(2);
    expect(breadcrumbs).toContain("push not read into the cache");
  } finally {
    installReportSink(null);
  }
});
