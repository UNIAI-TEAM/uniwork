// Render counts for the Chat tab (audit H1/H3, P2 Perf): the real screen, its
// rows counted through RoomAvatar, which only a row that renders reaches. A
// typing frame, a presence change and a new message each redraw the one row
// they change; a regression that redraws the list shows up here as a count.
import { ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import ChatTab from "@/app/(app)/[org]/[ws]/(tabs)/chat";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { render } from "@/test/render";

const mockRenders = new Map<string, number>();
jest.mock("./room-avatar", () => ({
  RoomAvatar: ({ seed }: { seed: string }): ReactNode => {
    mockRenders.set(seed, (mockRenders.get(seed) ?? 0) + 1);
    return null;
  },
}));
jest.mock("./connection-banner", () => ({ ConnectionBanner: () => null }));
// The query client wires NetInfo at load; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});

const T0 = Date.UTC(2026, 9, 21, 2, 0);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

const dm = (n: number): ChatRoomRecord =>
  ChatRoomSchema.parse({
    id: `dm${n}`,
    kind: "dm",
    name: `Người ${n}`,
    workspace_id: "w1",
    member_count: 2,
    peer_user_id: `U${n}`,
    peer_display_name: `Người ${n}`,
    last_message_body: `chào ${n}`,
    last_message_sender_id: `U${n}`,
    last_message_at: at(n),
  });
const group = (n: number): ChatRoomRecord =>
  ChatRoomSchema.parse({ id: `g${n}`, kind: "group", name: `Nhóm ${n}`, workspace_id: "w1", member_count: 3, last_message_body: "ok", last_message_sender_id: "U1", last_message_at: at(n) });

const rooms = [dm(1), dm(2), dm(3), dm(4), group(5), group(6), dm(7), group(8)];

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
  // The tab bar opens the tab without params: the workspace pair comes from the URL.
  jest.spyOn(jest.requireMock<{ useGlobalSearchParams: () => object }>("expo-router"), "useGlobalSearchParams").mockReturnValue({ org: "acme", ws: "hq" });
  useAuthStore.setState({ user: { id: "ME", email: "me@acme.vn", display_name: "Tôi" } as never });
  jest.spyOn(api, "listWorkspaces").mockResolvedValue([{ id: "w1", slug: "hq", name: "HQ", organization_slug: "acme" } as never]);
  jest.spyOn(chatApi, "listRooms").mockResolvedValue(rooms);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "unreadSummary").mockResolvedValue({ direct: { unread: 0, mentions: 0 }, workspaces: [] });
});
afterEach(async () => {
  await act(async () => {
    useSidebarTypingStore.getState().clearAll();
    usePresenceStore.getState().clearAll();
  });
  useAuthStore.setState({ user: null });
  jest.restoreAllMocks();
});

describe("Chat tab render counts", () => {
  it("a typing frame redraws the room typed in; a presence change the row of that person", async () => {
    await render(<ChatTab />);
    await settle();
    expect(Object.keys(take())).toHaveLength(rooms.length);

    await act(async () => useSidebarTypingStore.getState().bump("g6", "U1", "ME"));
    expect(screen.getByText(/đang nhập/)).toBeOnTheScreen();
    expect(take()).toEqual({ g6: 1 });

    await act(async () => usePresenceStore.getState().bump("U3", "ME"));
    expect(take()).toEqual({ dm3: 1 });
  });

  it("a new message redraws its room only, moved to the top", async () => {
    const { queryClient } = await render(<ChatTab />);
    await settle();
    take();

    await act(async () =>
      queryClient.setQueryData(
        chatKeys.rooms("w1"),
        rooms.map((room) => (room.id === "dm2" ? { ...room, last_message_body: "mới", last_message_at: at(99), unread_count: 1 } : room)),
      ),
    );
    await settle();
    expect(take()).toEqual({ dm2: 1 });
    expect(screen.getByText("mới")).toBeOnTheScreen();
  });
});
