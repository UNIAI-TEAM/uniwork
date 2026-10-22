// The workspace's own screens as the router runs them (review P2: only the entry gates were rendered here, the
// workspace's screens were stand-ins): app/(app)/[org]/[ws]/_layout.tsx with its socket and subscriptions, the tab
// bar, the Chat tab, a room, its details and a thread, against one fake server behind data/api.ts › request and a
// fake socket (test/fake-ws-client.ts), both in test/workspace-server.tsx. What each screen's parts do in depth is
// their component tests; this is the wiring between the screens: who reaches which, with which data, and what the
// URL says. What a person does on each screen (create, join, mute, leave…) is test/routes/screens.test.tsx.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { api } from "@/data/api";
import { permissionGate } from "@/components/ui/permission-gate";
import { callEngine } from "@/data/calls/call-store";
import { remoteConfigOptions } from "@/data/remote-config";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { FakeWSClient } from "@/test/fake-ws-client";
import { viText } from "@/test/render";
import { installWorkspaceServer, mount, world } from "@/test/workspace-server";

jest.unmock("expo-router");
jest.mock("@/data/realtime/ws-client", () => ({ WSClient: jest.requireActual("@/test/fake-ws-client").FakeWSClient }));
// jest-expo's native token emitter hands back no subscription: the layout's token-rotation watch needs one to remove.
jest.mock("expo-notifications", () => ({ ...jest.requireActual("expo-notifications"), addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
// Swipe-to-reply is a gesture wrapper around each bubble, not what these routes test; its own test is
// components/chat/swipe-to-reply.test.tsx.
jest.mock("@/components/chat/swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: React.ReactNode }) => children }));
// Sentry's full-display marker; the SDK ships ESM Jest does not load (and reports nothing without a DSN).
jest.mock("@/data/sentry", () => ({ ScreenFullyDrawn: () => null }));
// The composer's recorder: expo-audio's recorder is a native object; its own test is use-voice-recorder.test.tsx.
jest.mock("@/components/chat/use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

installWorkspaceServer();

describe("the workspace", () => {
  it("opens its socket for the org/ws pair and lists its conversations on the Chat tab", async () => {
    const routes = await mount("/acme/hq/chat");
    expect(await screen.findByText("Bình Trần")).toBeOnTheScreen();
    expect(screen.getByText("Nhóm sản phẩm")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/chat");
    expect(FakeWSClient.latest().opts.workspaceSlug).toBe("acme/hq");
    // The kill switches are evaluated for this workspace's organization from now on.
    await act(async () => routes.queryClient.fetchQuery({ ...remoteConfigOptions(), staleTime: 0 }));
    expect(world.requests).toContain("GET /api/v1/config?organization_id=o1");
    // The tab bar's four tabs.
    for (const tab of [viText("nav.chat"), viText("mobile.tab_calls"), viText("nav.people"), viText("nav.settings")]) {
      expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
    }
  });

  it("sends a link to a workspace the person is not in back to the picker", async () => {
    const routes = await mount("/acme/elsewhere/chat");
    expect(await screen.findByRole("button", { name: /HQ/ })).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/select-workspace");
    expect(FakeWSClient.instances).toHaveLength(0);
  });

  it("opens a room from the list, marks it read and makes it the socket's first scope", async () => {
    const routes = await mount("/acme/hq/chat");
    await fireEvent.press(await screen.findByText("Bình Trần"));
    expect(await screen.findByText("Ai xem bản nháp chưa?")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1");
    expect(useActiveChatRoomStore.getState().roomId).toBe("r1");
    await waitFor(() => expect(world.requests.some((r) => r.startsWith("POST /api/v1/workspaces/w1/chat/rooms/r1/read"))).toBe(true));
    expect(FakeWSClient.latest().subscriptions).toContain("chat:r1");
  });

  it("goes from a room to its details and back, and into a thread and back", async () => {
    const routes = await mount("/acme/hq/room/r1");
    await fireEvent.press(await screen.findByRole("button", { name: new RegExp(viText("chat.mobile.room_info")) }));
    expect(await screen.findByText(viText("chat.mobile.room_info"))).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1/info");
    // The DM's details name the person and list both members.
    expect((await screen.findAllByText("Bình Trần")).length).toBeGreaterThan(0);
    await waitFor(() => expect(world.requests).toContain("GET /api/v1/workspaces/w1/chat/rooms/r1/shared-summary"));

    await fireEvent.press(screen.getAllByRole("button", { name: viText("common.back") }).at(-1) as never);
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));

    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.thread_replies", { count: 1 }) }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1/thread/m1"));
    expect(await screen.findByText("Mình xem rồi")).toBeOnTheScreen();
    // The thread over the room is the room on screen; back in the room, the room still is.
    expect(useActiveChatRoomStore.getState().roomId).toBe("r1");
    await fireEvent.press(screen.getAllByRole("button", { name: viText("chat.mobile.back_to_conversation") }).at(-1) as never);
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));
    expect(useActiveChatRoomStore.getState().roomId).toBe("r1");
  });

  it("lists every member of a room on a screen of their own", async () => {
    const routes = await mount("/acme/hq/room/r1/members");
    expect(await screen.findByText(`${viText("chat.members_title")} · 2`)).toBeOnTheScreen();
    expect(await screen.findByText("Bình Trần")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1/members");
  });

  it("opens a thread with its root and replies, and marks it read", async () => {
    const routes = await mount("/acme/hq/room/r1/thread/m1");
    expect(await screen.findByText("Ai xem bản nháp chưa?")).toBeOnTheScreen();
    expect(await screen.findByText("Mình xem rồi")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.thread_title"))).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1/thread/m1");
    await waitFor(() => expect(world.requests.some((r) => r.startsWith("POST /api/v1/workspaces/w1/chat/threads/m1/read"))).toBe(true));
  });

  it("closes the socket when the person leaves the workspace", async () => {
    await mount("/acme/hq/chat");
    await screen.findByText("Bình Trần");
    const ws = FakeWSClient.latest();
    await cleanup();
    expect(ws.calls.at(-1)).toBe("disconnect");
    expect(ws.listenerCount()).toBe(0);
  });
});

describe("the workspace's other screens", () => {
  it("lists the calls, and a call opens its conversation at the call", async () => {
    const routes = await mount("/acme/hq/calls");
    expect((await screen.findAllByText(viText("mobile.tab_calls"))).length).toBeGreaterThan(0);
    await waitFor(() => expect(world.requests).toContain("GET /api/v1/workspaces/w1/chat/call-logs"));
    await fireEvent.press(await screen.findByText("Bình Trần"));
    await waitFor(() => expect(routes.pathname()).toMatch(/^\/acme\/hq\/(chat|room\/r1)/));
  });

  it("lists the people of the workspace, and a person opens the DM with them", async () => {
    const routes = await mount("/acme/hq/contacts");
    expect((await screen.findAllByText("Chi Lê")).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByText("Bình Trần").at(-1) as never);
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));
    expect(world.requests).toContain("POST /api/v1/workspaces/w1/chat/dm");
  });

  it("shows the person and the workspace in Settings, and opens the licenses", async () => {
    const routes = await mount("/acme/hq/settings");
    expect(await screen.findByText("me@acme.vn")).toBeOnTheScreen();
    expect(screen.getAllByText("HQ").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("legal-licenses"));
    await waitFor(() => expect(routes.pathname()).toBe("/licenses"));
    expect(await screen.findAllByText(viText("mobile.licenses.title"))).not.toHaveLength(0);
  });

  it("starts a conversation from the Chat tab's new-message button", async () => {
    const routes = await mount("/acme/hq/chat");
    await fireEvent.press(await screen.findByRole("button", { name: viText("chat.new_conversation_aria") }));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/new-chat"));
    expect(await screen.findByText(viText("chat.start_dm_title"))).toBeOnTheScreen();
    expect(await screen.findByText("Chi Lê")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(viText("chat.create_group")));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/new-group"));
    expect((await screen.findAllByText(viText("chat.create_group_title"))).length).toBeGreaterThan(0);
  });

  it("browses the workspace's channels", async () => {
    const routes = await mount("/acme/hq/channels");
    expect(await screen.findByText(viText("chat.channel.directory_title"))).toBeOnTheScreen();
    expect(await screen.findByText("Tin chung")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/channels");
  });
});

describe("a room opened on an older message", () => {
  it("shows the page around the linked message, then goes back to the latest", async () => {
    const routes = await mount("/acme/hq/room/r1?message=m0");
    expect(await screen.findByText("Tuần trước đã chốt bản này")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.search_jump_banner"))).toBeOnTheScreen();
    // The banner's own button (the jump-to-latest button below the list goes back too).
    await fireEvent.press(screen.getByText(viText("chat.search_back_to_latest")));
    expect(await screen.findByText("Hẹn 3 giờ nhé")).toBeOnTheScreen();
    expect(screen.queryByText(viText("chat.search_jump_banner"))).toBeNull();
    expect(routes.pathname()).toBe("/acme/hq/room/r1");
  });
});

describe("a room whose first page fails", () => {
  it("says so instead of an empty room, and retries", async () => {
    let failing = true;
    const answer = jest.mocked(api.request).getMockImplementation();
    jest.mocked(api.request).mockImplementation(async (path: string, init?: RequestInit) => {
      if (failing && path === "/api/v1/workspaces/w1/chat/rooms/r1/messages?limit=50&mark_read=0") throw new Error("down");
      return answer?.(path, init);
    });
    await mount("/acme/hq/room/r1");
    expect(await screen.findByTestId("conversation-load-error")).toBeOnTheScreen();
    failing = false;
    await fireEvent.press(screen.getByTestId("conversation-retry"));
    expect(await screen.findByText("Hẹn 3 giờ nhé")).toBeOnTheScreen();
  });
});

describe("calling from a room", () => {
  it("starts a voice call from the room's header after the microphone is granted", async () => {
    jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
    const start = jest.spyOn(callEngine, "startCall").mockResolvedValue(undefined as never);
    await mount("/acme/hq/room/r1");
    await fireEvent.press(await screen.findByTestId("room-call-voice"));
    await waitFor(() => expect(start).toHaveBeenCalledWith("r1", "Bình Trần", "dm", { withCamera: false }));
    expect(permissionGate.ensure).toHaveBeenCalledWith("microphone", "call", { callId: undefined });
  });

  it("starts a video call from the room's header with the camera", async () => {
    jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
    const start = jest.spyOn(callEngine, "startCall").mockResolvedValue(undefined as never);
    await mount("/acme/hq/room/r1");
    await fireEvent.press(await screen.findByTestId("room-call-video"));
    await waitFor(() => expect(start).toHaveBeenCalledWith("r1", "Bình Trần", "dm", { withCamera: true }));
  });

  it("hides calling in the room and its details while the server's kill switch is off", async () => {
    world.callsOn = false;
    const routes = await mount("/acme/hq/room/r1");
    await act(async () => routes.queryClient.fetchQuery({ ...remoteConfigOptions(), staleTime: 0 }));
    expect(await screen.findByText("Ai xem bản nháp chưa?")).toBeOnTheScreen();
    expect(screen.queryByTestId("room-call-voice")).toBeNull();
    expect(screen.queryByTestId("room-call-video")).toBeNull();
  });
});
