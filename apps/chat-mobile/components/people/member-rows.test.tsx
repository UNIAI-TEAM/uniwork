// Render counts for the three screens that list people with their presence
// (audit P2 Perf, S5 review): the new-message picker, the group picker and a
// room's details. Each row reads its own person's presence (useIsOnline), so a
// presence change redraws the row of the person who came or went, not the whole
// screen. Rows are counted through PersonAvatar, which only a drawn row reaches.
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import NewChatScreen from "@/app/(app)/[org]/[ws]/new-chat";
import NewGroupScreen from "@/app/(app)/[org]/[ws]/new-group";
import RoomInfoScreen from "@/app/(app)/[org]/[ws]/room/[roomId]/info";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { render, viText } from "@/test/render";
import { ChatRoomSchema } from "@uniwork/core/api/endpoints/chat-schemas";

const mockRenders = new Map<string, number>();
jest.mock("./person-avatar", () => ({
  ...jest.requireActual<typeof import("./person-avatar")>("./person-avatar"),
  PersonAvatar: ({ seed, online }: { seed: string; online?: boolean }): ReactNode => {
    const key = `${seed}${online ? ":online" : ""}`;
    mockRenders.set(key, (mockRenders.get(key) ?? 0) + 1);
    return null;
  },
}));
jest.mock("@/components/chat/connection-banner", () => ({ ConnectionBanner: () => null }));
// The query client wires NetInfo at load; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});

type RouterMock = { useLocalSearchParams: () => object; Stack?: { Screen: () => null } };
const routerMock = jest.requireMock<RouterMock>("expo-router");
routerMock.Stack = { Screen: () => null };

const people = ["U1", "U2", "U3", "U4"].map((id, i) => ({ user_id: id, email: i === 3 ? "" : `${id.toLowerCase()}@acme.vn`, display_name: `Người ${i + 1}` }));
const roomMembers = [{ user_id: "ME", email: "me@acme.vn", display_name: "Tôi" }, ...people].map((m, i) => ({
  ...m,
  role: i === 1 ? "admin" : "member",
  send_restricted: false,
  is_creator: false,
}));

const take = () => {
  const counts = Object.fromEntries(mockRenders);
  mockRenders.clear();
  return counts;
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  mockRenders.clear();
  jest.spyOn(routerMock, "useLocalSearchParams").mockReturnValue({ org: "acme", ws: "hq", roomId: "g1" });
  useAuthStore.setState({ user: { id: "ME", email: "me@acme.vn", display_name: "Tôi" } as never });
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([{ id: "w1", slug: "hq", name: "HQ", organization_slug: "acme" } as never]);
  // GET /api/v1/config: no answer worth reading, so every flag stays at its default.
  jest.spyOn(api, "request").mockResolvedValue({});
  const group = ChatRoomSchema.parse({ id: "g1", kind: "group", name: "Thiết kế", workspace_id: "w1", member_count: 5 });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([group]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue(roomMembers);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue(people);
  jest.spyOn(chatApi, "sharedSummary").mockResolvedValue({ counts: { photo: 0, gif: 0, video: 0, file: 0, link: 0, voice: 0 }, recent_photos: [] });
});
afterEach(async () => {
  await act(async () => usePresenceStore.getState().clearAll());
  useAuthStore.setState({ user: null });
  jest.restoreAllMocks();
});

describe("people rows read their own presence", () => {
  it("new message: a presence change redraws that person's row, and the row says they are online", async () => {
    await render(<NewChatScreen />);
    await settle();
    expect(take()).toEqual({ U1: 1, U2: 1, U3: 1, U4: 1 });

    await act(async () => usePresenceStore.getState().bump("U3", "ME"));
    expect(take()).toEqual({ "U3:online": 1 });
    expect(screen.getByLabelText(`${viText("chat.start_dm")}: Người 3, ${viText("chat.presence_online")}`)).toBeOnTheScreen();

    // Opening a DM marks that row busy and holds the others; nothing else redraws.
    jest.spyOn(chatApi, "resolveDMRoom").mockReturnValue(new Promise(() => undefined));
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.start_dm")}: Người 4` }));
    expect(screen.getByRole("button", { name: `${viText("chat.start_dm")}: Người 4` })).toBeBusy();
    expect(screen.getByRole("button", { name: `${viText("chat.start_dm")}: Người 1` })).toBeDisabled();
  });

  it("new group: a presence change redraws that person's row; picking someone still redraws their row", async () => {
    await render(<NewGroupScreen />);
    await settle();
    take();

    await act(async () => usePresenceStore.getState().bump("U2", "ME"));
    expect(take()).toEqual({ "U2:online": 1 });

    await fireEvent.press(screen.getByRole("checkbox", { name: "Người 4" }));
    expect(screen.getByRole("checkbox", { name: "Người 4" })).toBeChecked();
    // Their row, and their face in the strip of picked people.
    expect(take()).toEqual({ U4: 2 });
  });

  it("adding to a group: someone already in it reads as picked and cannot be unpicked", async () => {
    jest.spyOn(routerMock, "useLocalSearchParams").mockReturnValue({ org: "acme", ws: "hq", room: "g1" });
    await render(<NewGroupScreen />);
    await settle();
    const inGroup = screen.getByRole("checkbox", { name: `Người 1, ${viText("chat.already_in_group")}` });
    expect(inGroup).toBeChecked();
    expect(inGroup).toBeDisabled();
  });

  it("room details: a presence change redraws that member's row, which reads them as online", async () => {
    await render(<RoomInfoScreen />);
    await settle();
    expect(take()).toEqual({ ME: 1, U1: 1, U2: 1, U3: 1, U4: 1 });

    await act(async () => usePresenceStore.getState().bump("U1", "ME"));
    expect(take()).toEqual({ "U1:online": 1 });
    expect(screen.getByLabelText(`Người 1, ${viText("chat.presence_online")}, ${viText("chat.mobile.room_role_admin_short")}`)).toBeOnTheScreen();

    // One's own row only reads out; someone else's opens their menu.
    expect(screen.queryByRole("button", { name: /^Tôi|^Bạn/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Người 2, u2@acme.vn" }));
    expect(screen.getByText(viText("mobile.report.action_user", { name: "Người 2" }))).toBeOnTheScreen();
    expect(take()).toEqual({});
  });
});
