// The workspace's own screens as the router runs them (review P2: only the entry gates were rendered here, the
// workspace's screens were stand-ins): app/(app)/[org]/[ws]/_layout.tsx with its socket and subscriptions, the tab
// bar, the Chat tab, a room, its details and a thread, against one fake server behind data/api.ts › request and a
// fake socket (test/fake-ws-client.ts). What each screen's parts do in depth is their component tests; this is the
// wiring between the screens: who reaches which, with which data, and what the URL says.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { EMPTY_UNREAD_SUMMARY } from "@uniwork/core/api/endpoints/chat-schemas";
import type { Workspace } from "@uniwork/core/types/workspace";
import AppLayout from "@/app/(app)/_layout";
import WorkspaceLayout from "@/app/(app)/[org]/[ws]/_layout";
import ChannelsScreen from "@/app/(app)/[org]/[ws]/channels";
import LicensesScreen from "@/app/(app)/[org]/[ws]/licenses";
import NewChatScreen from "@/app/(app)/[org]/[ws]/new-chat";
import NewGroupScreen from "@/app/(app)/[org]/[ws]/new-group";
import TabsLayout from "@/app/(app)/[org]/[ws]/(tabs)/_layout";
import CallsTab from "@/app/(app)/[org]/[ws]/(tabs)/calls";
import ChatTab from "@/app/(app)/[org]/[ws]/(tabs)/chat";
import ContactsTab from "@/app/(app)/[org]/[ws]/(tabs)/contacts";
import SettingsTab from "@/app/(app)/[org]/[ws]/(tabs)/settings";
import RoomInfoScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/info";
import RoomScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/index";
import ThreadScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/thread/[rootId]";
import SelectWorkspace from "@/app/(app)/select-workspace";
import { api } from "@/data/api";
import { permissionGate } from "@/components/ui/permission-gate";
import { callEngine } from "@/data/calls/call-store";
import { remoteConfigOptions } from "@/data/remote-config";
import { useAuthStore } from "@/data/auth/store";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { i18n } from "@/lib/i18n/singleton";
import { FakeWSClient } from "@/test/fake-ws-client";
import { renderRoutes } from "@/test/route-render";
import { viText } from "@/test/render";

jest.unmock("expo-router");
jest.mock("@/data/realtime/ws-client", () => ({ WSClient: jest.requireActual("@/test/fake-ws-client").FakeWSClient }));
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
// Swipe-to-reply's pan mixes worklet and JS callbacks, which the gesture runtime's Jest build rejects;
// its own test is components/chat/swipe-to-reply.test.tsx.
jest.mock("@/components/chat/swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: React.ReactNode }) => children }));
// Sentry's full-display marker; the SDK ships ESM Jest does not load (and reports nothing without a DSN).
jest.mock("@/data/sentry", () => ({ ScreenFullyDrawn: () => null }));
// The composer's recorder: expo-audio's recorder is a native object; its own test is use-voice-recorder.test.tsx.
jest.mock("@/components/chat/use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const ROUTES = {
  "(app)/_layout": AppLayout,
  "(app)/select-workspace": SelectWorkspace,
  "(app)/[org]/[ws]/_layout": WorkspaceLayout,
  "(app)/[org]/[ws]/(tabs)/_layout": TabsLayout,
  "(app)/[org]/[ws]/(tabs)/chat": ChatTab,
  "(app)/[org]/[ws]/(tabs)/calls": CallsTab,
  "(app)/[org]/[ws]/(tabs)/contacts": ContactsTab,
  "(app)/[org]/[ws]/(tabs)/settings": SettingsTab,
  "(app)/[org]/[ws]/new-chat": NewChatScreen,
  "(app)/[org]/[ws]/new-group": NewGroupScreen,
  "(app)/[org]/[ws]/channels": ChannelsScreen,
  "(app)/[org]/[ws]/licenses": LicensesScreen,
  "(app)/[org]/[ws]/room/[roomId]/index": RoomScreen,
  "(app)/[org]/[ws]/room/[roomId]/info": RoomInfoScreen,
  "(app)/[org]/[ws]/room/[roomId]/thread/[rootId]": ThreadScreen,
};

const T0 = Date.UTC(2026, 9, 21, 2, 0);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();
const workspace = { id: "w1", slug: "hq", name: "HQ", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" } as Workspace;

const dm = {
  id: "r1",
  kind: "dm",
  name: "",
  workspace_id: "w1",
  member_count: 2,
  member_user_ids: ["ME", "U2"],
  peer_user_id: "U2",
  peer_display_name: "Bình Trần",
  last_message_body: "Hẹn 3 giờ nhé",
  last_message_sender_id: "U2",
  last_message_at: at(3),
  unread_count: 1,
};
const group = { id: "g1", kind: "group", name: "Nhóm sản phẩm", workspace_id: "w1", member_count: 3, member_user_ids: ["ME", "U2", "U3"], last_message_at: at(1) };
const message = (id: string, sender: string, body: string, minute: number, extra: object = {}) => ({
  id,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: sender,
  sender_display_name: sender === "ME" ? "Tôi" : "Bình Trần",
  body,
  created_at: at(minute),
  ...extra,
});
const root = message("m1", "U2", "Ai xem bản nháp chưa?", 1, { reply_count: 1, last_reply_at: at(2) });
const reply = message("m3", "ME", "Mình xem rồi", 2, { thread_root_id: "m1" });
const latest = message("m2", "U2", "Hẹn 3 giờ nhé", 3);
const channel = { id: "c1", kind: "channel", name: "thong-bao", workspace_id: "w1", member_count: 12, member_user_ids: [], topic: "Tin chung" };
const callLog = {
  message_id: "cl1",
  room_id: "r1",
  room_kind: "dm",
  room_name: "",
  peer_user_id: "U2",
  call_id: "call-1",
  outcome: "completed",
  video: false,
  caller_id: "U2",
  caller_name: "Bình Trần",
  duration_seconds: 75,
  ended_at: at(4),
  participants: [{ user_id: "U2", display_name: "Bình Trần" }],
};
const member = (user_id: string, display_name: string) => ({ user_id, role: "member", email: `${user_id.toLowerCase()}@acme.vn`, display_name });

/** The server, by path: what each screen reads. Anything else answers {} (the schemas fall back). */
function server(path: string, init?: RequestInit): unknown {
  const url = path.split("?")[0] ?? path;
  const method = init?.method ?? "GET";
  if (method === "POST" && url === "/api/v1/workspaces/w1/chat/dm") return { room: dm };
  if (method !== "GET") return {};
  if (url === "/api/v1/workspaces/w1/chat/call-logs") return { call_logs: [callLog], next_cursor: null };
  if (url === "/api/v1/workspaces/w1/chat/channels") return { rooms: [channel] };
  if (url === "/api/v1/workspaces/w1/chat/rooms") return { rooms: [dm, group] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1") return { room: dm };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/messages") return { messages: [latest, root] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/threads/m1/messages") return { messages: [root, reply] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/members") return { members: [member("ME", "Tôi"), member("U2", "Bình Trần")] };
  if (url === "/api/v1/workspaces/w1/members") return { members: [member("ME", "Tôi"), member("U2", "Bình Trần"), member("U3", "Chi Lê")] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/shared-summary") return { counts: { media: 0, files: 0, links: 0 } };
  if (url === "/api/v1/me/chat/unread-summary") return EMPTY_UNREAD_SUMMARY;
  if (url === "/api/v1/config") return { min_supported_mobile_version: "", mobile_flags: { unichat_mobile_calls: callsOn } };
  return {};
}

let requests: string[] = [];
/** The server's calls kill switch (GET /api/v1/config › mobile_flags.unichat_mobile_calls). */
let callsOn = true;
// The server answers only once the router is mounted: renderRouter mounts under fake timers, and a TanStack batch
// scheduled on a fake timer that test/route-render.tsx does not run would hold every later update of the screen.
let release: () => void = () => undefined;

/** The routes at `url`, with the server let through once they are mounted. */
async function mount(url: string) {
  const routes = await renderRoutes(ROUTES, url);
  release();
  return routes;
}

beforeEach(async () => {
  await i18n.changeLanguage("vi");
  FakeWSClient.reset();
  requests = [];
  callsOn = true;
  // The person's language is the app's (the settings tab syncs it): Vietnamese, as viText reads.
  useAuthStore.setState({ user: { id: "ME", email: "me@acme.vn", display_name: "Tôi", locale: "vi" } as never, isLoading: false });
  useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "hq", wsId: "w1" } });
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([workspace]);
  const gate = new Promise<void>((resolve) => (release = resolve));
  jest.spyOn(api, "request").mockImplementation(async (path: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    await gate;
    return server(path, init);
  });
});

afterEach(async () => {
  await cleanup();
  useAuthStore.setState({ user: null, isLoading: true });
  useWorkspaceStore.setState({ current: null });
  useActiveChatRoomStore.setState({ roomId: null });
  await i18n.changeLanguage("vi");
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the workspace", () => {
  it("opens its socket for the org/ws pair and lists its conversations on the Chat tab", async () => {
    const routes = await mount("/acme/hq/chat");
    expect(await screen.findByText("Bình Trần")).toBeOnTheScreen();
    expect(screen.getByText("Nhóm sản phẩm")).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/chat");
    expect(FakeWSClient.latest().opts.workspaceSlug).toBe("acme/hq");
    // The kill switches are evaluated for this workspace's organization from now on.
    await act(async () => routes.queryClient.fetchQuery({ ...remoteConfigOptions(), staleTime: 0 }));
    expect(requests).toContain("GET /api/v1/config?organization_id=o1");
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
    await waitFor(() => expect(requests.some((r) => r.startsWith("POST /api/v1/workspaces/w1/chat/rooms/r1/read"))).toBe(true));
    expect(FakeWSClient.latest().subscriptions).toContain("chat:r1");
  });

  it("goes from a room to its details and back, and into a thread and back", async () => {
    const routes = await mount("/acme/hq/room/r1");
    await fireEvent.press(await screen.findByRole("button", { name: new RegExp(viText("chat.mobile.room_info")) }));
    expect(await screen.findByText(viText("chat.mobile.room_info"))).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1/info");
    // The DM's details name the person and list both members.
    expect((await screen.findAllByText("Bình Trần")).length).toBeGreaterThan(0);
    await waitFor(() => expect(requests).toContain("GET /api/v1/workspaces/w1/chat/rooms/r1/shared-summary"));

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

  it("opens a thread with its root and replies, and marks it read", async () => {
    const routes = await mount("/acme/hq/room/r1/thread/m1");
    expect(await screen.findByText("Ai xem bản nháp chưa?")).toBeOnTheScreen();
    expect(await screen.findByText("Mình xem rồi")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.thread_title"))).toBeOnTheScreen();
    expect(routes.pathname()).toBe("/acme/hq/room/r1/thread/m1");
    await waitFor(() => expect(requests.some((r) => r.startsWith("POST /api/v1/workspaces/w1/chat/threads/m1/read"))).toBe(true));
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
    await waitFor(() => expect(requests).toContain("GET /api/v1/workspaces/w1/chat/call-logs"));
    await fireEvent.press(await screen.findByText("Bình Trần"));
    await waitFor(() => expect(routes.pathname()).toMatch(/^\/acme\/hq\/(chat|room\/r1)/));
  });

  it("lists the people of the workspace, and a person opens the DM with them", async () => {
    const routes = await mount("/acme/hq/contacts");
    expect((await screen.findAllByText("Chi Lê")).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getAllByText("Bình Trần").at(-1) as never);
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/room/r1"));
    expect(requests).toContain("POST /api/v1/workspaces/w1/chat/dm");
  });

  it("shows the person and the workspace in Settings, and opens the licenses", async () => {
    const routes = await mount("/acme/hq/settings");
    expect(await screen.findByText("me@acme.vn")).toBeOnTheScreen();
    expect(screen.getAllByText("HQ").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("legal-licenses"));
    await waitFor(() => expect(routes.pathname()).toBe("/acme/hq/licenses"));
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

describe("calling from a room", () => {
  it("starts a voice call from the room's header after the microphone is granted", async () => {
    jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
    const start = jest.spyOn(callEngine, "startCall").mockResolvedValue(undefined as never);
    await mount("/acme/hq/room/r1");
    await fireEvent.press(await screen.findByTestId("room-call-voice"));
    await waitFor(() => expect(start).toHaveBeenCalledWith("r1", "Bình Trần", "dm", { withCamera: false }));
    expect(permissionGate.ensure).toHaveBeenCalledWith("microphone", "call", { callId: undefined });
  });

  it("hides calling in the room and its details while the server's kill switch is off", async () => {
    callsOn = false;
    const routes = await mount("/acme/hq/room/r1");
    await act(async () => routes.queryClient.fetchQuery({ ...remoteConfigOptions(), staleTime: 0 }));
    expect(await screen.findByText("Ai xem bản nháp chưa?")).toBeOnTheScreen();
    expect(screen.queryByTestId("room-call-voice")).toBeNull();
    expect(screen.queryByTestId("room-call-video")).toBeNull();
  });
});
