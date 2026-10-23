// The chat hook's wiring (use-chat-realtime.ts) on a fake socket: frames reach chat-realtime.ts, a reconnect
// recovers it and flushes what the phone owes, the open and recent rooms are the socket's chat scopes, presence
// beats every 15 s while the app is in front and is left in the background, a sign-out drops the queued sends,
// and leaving the workspace removes every handler.
import { ChatRoomSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, renderHook } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { syncChat } from "@/data/chat-sync/sync";
import { flushOwed } from "@/data/owed";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useChatSendStore } from "@/data/stores/chat-send-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { FakeWSClient } from "@/test/fake-ws-client";
import { createChatRealtime } from "./chat-realtime";
import { useChatRealtime } from "./use-chat-realtime";
import { useChatScopes } from "./use-chat-scopes";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
const mockSocket: { current: FakeWSClient | null } = { current: null };
jest.mock("./realtime-provider", () => ({ useWSClient: () => mockSocket.current }));
const mockRealtime = { handle: jest.fn(), reconnect: jest.fn(), dispose: jest.fn() };
jest.mock("./chat-realtime", () => ({ createChatRealtime: jest.fn(() => mockRealtime) }));
jest.mock("./use-chat-scopes", () => ({ useChatScopes: jest.fn() }));
jest.mock("@/data/owed", () => ({ flushOwed: jest.fn(async () => undefined) }));
jest.mock("@/data/chat-sync/sync", () => ({ syncChat: jest.fn(async () => "synced") }));

const scopes = jest.mocked(useChatScopes);
// Every AppState listener (the query client listens too); a change reaches them all, as on the device.
let appStateListeners: ((status: AppStateStatus) => void)[] = [];
const appStateChange = (status: AppStateStatus) => {
  for (const listener of appStateListeners) listener(status);
};
const removeAppState = jest.fn();
const room = (id: string, unread = 0) => ChatRoomSchema.parse({ id, kind: "group", name: id, workspace_id: "w1", member_count: 3, unread_count: unread });

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, hook: renderHook(() => useChatRealtime("w1"), { wrapper }) };
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  jest.clearAllMocks();
  FakeWSClient.reset();
  mockSocket.current = new FakeWSClient({ url: "ws://test/api/v1/ws", getToken: () => "t", workspaceSlug: "acme/hq", clientOs: "android" });
  useAuthStore.setState({ user: { id: "ME" } as never });
  useActiveChatRoomStore.setState({ roomId: "r2" });
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateListeners.push(listener as (status: AppStateStatus) => void);
    return { remove: removeAppState };
  });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([room("r1", 3), room("r2"), room("r3")]);
  jest.spyOn(chatApi, "beatPresence").mockResolvedValue(["U2"]);
  jest.spyOn(chatApi, "leavePresence").mockResolvedValue(undefined as never);
  jest.spyOn(useChatPinsStore.getState(), "load").mockResolvedValue(undefined);
  jest.spyOn(usePresenceStore.getState(), "reconcile");
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useChatRealtime", () => {
  it("hands every frame to chat-realtime and recovers it on a reconnect, flushing what the phone owes", async () => {
    const { queryClient, hook } = mount();
    await hook;
    const ws = mockSocket.current as FakeWSClient;
    expect(jest.mocked(createChatRealtime)).toHaveBeenCalledWith(queryClient, expect.objectContaining({ wsId: "w1" }));
    const viewer = jest.mocked(createChatRealtime).mock.calls[0]?.[1].viewer;
    expect(viewer?.()).toEqual({ userId: "ME", activeRoomId: "r2" });
    await act(async () => useAuthStore.setState({ user: null }));
    expect(viewer?.()).toEqual({ userId: null, activeRoomId: "r2" });
    await act(async () => useAuthStore.setState({ user: { id: "ME" } as never }));

    ws.emitFrame({ type: "chat.message.created", payload: { room_id: "r1" } });
    expect(mockRealtime.handle).toHaveBeenCalledWith({ type: "chat.message.created", payload: { room_id: "r1" } });
    ws.emitReconnect();
    expect(mockRealtime.reconnect).toHaveBeenCalledTimes(1);
    expect(flushOwed).toHaveBeenCalledWith(queryClient, "ME");
  });

  it("reads the chat change log on opening the workspace, and hands chat-realtime the log and the live check", async () => {
    const { queryClient, hook } = mount();
    await hook;
    const ws = mockSocket.current as FakeWSClient;
    expect(syncChat).toHaveBeenCalledWith(queryClient, "w1", "ME");
    const wired = jest.mocked(createChatRealtime).mock.calls[0]?.[1];
    await wired?.sync?.();
    expect(syncChat).toHaveBeenCalledTimes(2);
    ws.emitState("online");
    expect(wired?.isLive?.()).toBe(true);
    ws.emitState("waiting");
    expect(wired?.isLive?.()).toBe(false);
    ws.emitState("online");
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true, writable: true });
    expect(wired?.isLive?.()).toBe(false);
  });

  it("signed out: no log to read", async () => {
    useAuthStore.setState({ user: null });
    const { hook } = mount();
    await hook;
    expect(syncChat).not.toHaveBeenCalled();
    expect(jest.mocked(createChatRealtime).mock.calls[0]?.[1].sync).toBeUndefined();
  });

  it("subscribes the open room first, then the rooms with unread, then the rest", async () => {
    const { hook } = mount();
    await hook;
    await flush();
    const latest = scopes.mock.calls.at(-1)?.[0] ?? [];
    expect(latest[0]).toBe("r2");
    expect(latest).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
  });

  it("loads the workspace's pins and beats presence while the app is in front", async () => {
    jest.useFakeTimers();
    const { hook } = mount();
    await hook;
    expect(useChatPinsStore.getState().load).toHaveBeenCalledWith("w1");
    expect(chatApi.beatPresence).toHaveBeenCalledWith("w1", true);
    await act(async () => undefined);
    expect(usePresenceStore.getState().reconcile).toHaveBeenCalledWith(["U2"], "ME", expect.any(Number));
    await act(async () => jest.advanceTimersByTime(15_000));
    expect(chatApi.beatPresence).toHaveBeenCalledTimes(2);

    // Background: the beat stops and the phone leaves presence; back in front it beats again.
    await act(async () => appStateChange("background"));
    expect(chatApi.leavePresence).toHaveBeenCalledWith("w1");
    // A second background event with no beat running only leaves again.
    await act(async () => appStateChange("background"));
    expect(chatApi.leavePresence).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(chatApi.beatPresence).toHaveBeenCalledTimes(2);
    await act(async () => appStateChange("inactive"));
    await act(async () => appStateChange("active"));
    await act(async () => appStateChange("active"));
    expect(chatApi.beatPresence).toHaveBeenCalledTimes(3);
  });

  it("survives a failed beat or leave, and a beat with no snapshot reconciles nothing", async () => {
    jest.mocked(chatApi.beatPresence).mockRejectedValueOnce(new Error("offline"));
    jest.mocked(chatApi.leavePresence).mockRejectedValueOnce(new Error("offline"));
    const { hook } = mount();
    const { unmount } = await hook;
    await flush();
    expect(usePresenceStore.getState().reconcile).not.toHaveBeenCalled();
    jest.mocked(chatApi.beatPresence).mockResolvedValueOnce(null);
    await act(async () => appStateChange("background"));
    await act(async () => appStateChange("active"));
    await flush();
    expect(usePresenceStore.getState().reconcile).not.toHaveBeenCalled();
    await act(async () => unmount());
  });

  it("starts no heartbeat in the background or signed out", async () => {
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true, writable: true });
    const { hook } = mount();
    const { unmount } = await hook;
    expect(chatApi.beatPresence).not.toHaveBeenCalled();
    await act(async () => unmount());

    useAuthStore.setState({ user: null });
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
    await mount().hook;
    expect(chatApi.beatPresence).not.toHaveBeenCalled();
    // Signed out on a reconnect: nothing owed is flushed for nobody.
    mockSocket.current?.emitReconnect();
    expect(flushOwed).not.toHaveBeenCalled();
  });

  it("prunes presence every 2 s", async () => {
    jest.useFakeTimers();
    const prune = jest.spyOn(usePresenceStore.getState(), "prune");
    await mount().hook;
    await act(async () => jest.advanceTimersByTime(4_000));
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it("drops the queued sends when the person signs out", async () => {
    const clear = jest.spyOn(useChatSendStore.getState(), "clear");
    await mount().hook;
    await act(async () => useAuthStore.setState({ user: { id: "ME", email: "me@acme.vn" } as never }));
    expect(clear).not.toHaveBeenCalled();
    await act(async () => useAuthStore.setState({ user: null }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("removes every handler and clears typing and presence when the workspace closes", async () => {
    const typing = jest.spyOn(useSidebarTypingStore.getState(), "clearAll");
    const presence = jest.spyOn(usePresenceStore.getState(), "clearAll");
    const { hook } = mount();
    const { unmount } = await hook;
    await act(async () => unmount());
    expect(mockSocket.current?.listenerCount()).toBe(0);
    expect(mockRealtime.dispose).toHaveBeenCalledTimes(1);
    expect(typing).toHaveBeenCalled();
    expect(presence).toHaveBeenCalled();
    expect(removeAppState).toHaveBeenCalled();
    expect(chatApi.leavePresence).toHaveBeenCalledWith("w1");
  });
});
