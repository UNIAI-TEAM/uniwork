// The workspace's route tests' shared world (test/routes/workspace.test.tsx, test/routes/screens.test.tsx): every
// screen under app/(app), one fake server behind data/api.ts › request (by path; anything else answers {}) and the
// person signed in to workspace acme/hq. A test file still calls jest.unmock("expo-router") and its jest.mock()s
// itself (Jest hoists them per file), then installWorkspaceServer() at its top level.
import { cleanup } from "@testing-library/react-native";
import { EMPTY_UNREAD_SUMMARY } from "@uniwork/core/api/endpoints/chat-schemas";
import type { Workspace } from "@uniwork/core/types/workspace";
import AppLayout from "@/app/(app)/_layout";
import WorkspaceLayout from "@/app/(app)/[org]/[ws]/_layout";
import ChannelsScreen from "@/app/(app)/[org]/[ws]/channels";
import LicensesScreen from "@/app/(app)/licenses";
import NewChatScreen from "@/app/(app)/[org]/[ws]/new-chat";
import NewGroupScreen from "@/app/(app)/[org]/[ws]/new-group";
import TabsLayout from "@/app/(app)/[org]/[ws]/(tabs)/_layout";
import CallsTab from "@/app/(app)/[org]/[ws]/(tabs)/calls";
import ChatTab from "@/app/(app)/[org]/[ws]/(tabs)/chat";
import ContactsTab from "@/app/(app)/[org]/[ws]/(tabs)/contacts";
import SettingsTab from "@/app/(app)/[org]/[ws]/(tabs)/settings";
import RoomInfoScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/info";
import RoomScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/index";
import RoomMembersRoute from "@/app/(app)/[org]/[ws]/room/[roomId]/members";
import ThreadScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/thread/[rootId]";
import SelectWorkspace from "@/app/(app)/select-workspace";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { i18n } from "@/lib/i18n/singleton";
import { FakeWSClient } from "@/test/fake-ws-client";
import { renderRoutes } from "@/test/route-render";

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
  "(app)/licenses": LicensesScreen,
  "(app)/[org]/[ws]/room/[roomId]/index": RoomScreen,
  "(app)/[org]/[ws]/room/[roomId]/info": RoomInfoScreen,
  "(app)/[org]/[ws]/room/[roomId]/members": RoomMembersRoute,
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
export const group = { id: "g1", kind: "group", name: "Nhóm sản phẩm", workspace_id: "w1", member_count: 3, member_user_ids: ["ME", "U2", "U3"], last_message_at: at(1) };
export const message = (id: string, sender: string, body: string, minute: number, extra: object = {}) => ({
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
export const latest = message("m2", "U2", "Hẹn 3 giờ nhé", 3);
const older = message("m0", "U2", "Tuần trước đã chốt bản này", -10_000);
export const channel = { id: "c1", kind: "channel", name: "thong-bao", workspace_id: "w1", member_count: 12, member_user_ids: [], topic: "Tin chung" };
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
export const member = (user_id: string, display_name: string) => ({ user_id, role: "member", email: `${user_id.toLowerCase()}@acme.vn`, display_name });

/**
 * What one test's server says beyond the defaults, by method and path (`url` without the query, `path` with it):
 * an answer, a throw, or `undefined` to fall through to the defaults.
 */
type ServerOverride = (url: string, method: string, path: string, init?: RequestInit) => unknown;

/** The world one test runs in: the requests the screens made, the kill switch, and the server's extra answers. */
export const world = {
  requests: [] as string[],
  /** The server's calls kill switch (GET /api/v1/config › mobile_flags.unichat_mobile_calls). */
  callsOn: true,
  /** Asked first; `undefined` falls through to the defaults below. */
  override: null as ServerOverride | null,
};

/** The server, by path: what each screen reads. Anything else answers {} (the schemas fall back). */
function server(path: string, init?: RequestInit): unknown {
  const url = path.split("?")[0] ?? path;
  const method = init?.method ?? "GET";
  const answer = world.override?.(url, method, path, init);
  if (answer !== undefined) return answer;
  if (method === "POST" && url === "/api/v1/workspaces/w1/chat/dm") return { room: dm };
  if (method !== "GET") return {};
  if (url === "/api/v1/workspaces/w1/chat/call-logs") return { call_logs: [callLog], next_cursor: null };
  if (url === "/api/v1/workspaces/w1/chat/channels") return { rooms: [channel] };
  if (url === "/api/v1/workspaces/w1/chat/rooms") return { rooms: [dm, group] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1") return { room: dm };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/messages") return { messages: [latest, root] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/messages/around/m0") return { messages: [older] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/threads/m1/messages") return { messages: [root, reply] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/members") return { members: [member("ME", "Tôi"), member("U2", "Bình Trần")] };
  if (url === "/api/v1/workspaces/w1/members") return { members: [member("ME", "Tôi"), member("U2", "Bình Trần"), member("U3", "Chi Lê")] };
  if (url === "/api/v1/workspaces/w1/chat/rooms/r1/shared-summary") return { counts: { media: 0, files: 0, links: 0 } };
  if (url === "/api/v1/me/chat/unread-summary") return EMPTY_UNREAD_SUMMARY;
  if (url === "/api/v1/config") return { min_supported_mobile_version: "", mobile_flags: { unichat_mobile_calls: world.callsOn } };
  return {};
}

// The server answers only once the router is mounted: renderRouter mounts under fake timers, and a TanStack batch
// scheduled on a fake timer that test/route-render.tsx does not run would hold every later update of the screen.
let release: () => void = () => undefined;

/** The routes at `url`, with the server let through once they are mounted. */
export async function mount(url: string) {
  const routes = await renderRoutes(ROUTES, url);
  release();
  return routes;
}

/** Registers the signed-in person, the fake server and the cleanup around every test of the calling file. */
export function installWorkspaceServer(): void {
  beforeEach(async () => {
    await i18n.changeLanguage("vi");
    FakeWSClient.reset();
    world.requests = [];
    world.callsOn = true;
    world.override = null;
    // The person's language is the app's (the settings tab syncs it): Vietnamese, as viText reads.
    useAuthStore.setState({ user: { id: "ME", email: "me@acme.vn", display_name: "Tôi", locale: "vi" } as never, isLoading: false });
    useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "hq", wsId: "w1" } });
    jest.spyOn(api, "listWorkspaces").mockResolvedValue([workspace]);
    const gate = new Promise<void>((resolve) => (release = resolve));
    jest.spyOn(api, "request").mockImplementation(async (path: string, init?: RequestInit) => {
      world.requests.push(`${init?.method ?? "GET"} ${path}`);
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
}
