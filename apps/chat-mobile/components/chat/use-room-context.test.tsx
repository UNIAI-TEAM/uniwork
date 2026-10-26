// What a conversation reads about its room, and that what names a sender stays
// the same function while the people do (audit P2 Perf): a new message changes
// the room's record, and the rows must not be read again for it
// (lib/message-row-model.ts reuses a row only while its readers are the same).
import { ChatMessageSchema, ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import { i18n } from "@/lib/i18n/singleton";
import { toTimelineMessage } from "@/lib/timeline-display";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useRoomContext } from "./use-room-context";

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const dm = (lastAt: string): ChatRoomRecord =>
  ChatRoomSchema.parse({ id: "d1", kind: "dm", name: "", workspace_id: "w1", member_count: 2, peer_user_id: "U2", peer_display_name: "Bình Trần", last_message_at: lastAt });
const group = ChatRoomSchema.parse({ id: "g1", kind: "group", name: "Thiết kế", workspace_id: "w1", member_count: 3 });
const fromPeer = toTimelineMessage(
  ChatMessageSchema.parse({ id: "m1", room_id: "d1", workspace_id: "w1", sender_id: "U2", sender_display_name: "U2", kind: "text", body: "chào", created_at: "2026-10-21T02:00:00Z" }),
);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([dm("2026-10-21T02:00:00Z"), group]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe("useRoomContext", () => {
  it("names a DM's peer as the room does, and keeps the same reader when only the room's last message moved", async () => {
    const { qc, wrapper } = setup();
    const hook = await renderHook(() => useRoomContext(chat, "d1"), { wrapper });
    await waitFor(() => expect(hook.result.current.room?.id).toBe("d1"));
    expect(hook.result.current.isGroup).toBe(false);
    expect(hook.result.current.senderName(fromPeer)).toBe("Bình Trần");
    const reader = hook.result.current.senderName;

    await act(async () => qc.setQueryData(chatKeys.rooms("w1"), [dm("2026-10-21T03:00:00Z"), group]));
    await waitFor(() => expect(hook.result.current.room?.last_message_at).toBe("2026-10-21T03:00:00Z"));
    expect(hook.result.current.senderName).toBe(reader);

    // A new name for the peer is a new reader.
    await act(async () => qc.setQueryData(chatKeys.rooms("w1"), [{ ...dm("2026-10-21T03:00:00Z"), peer_display_name: "Bình T." }, group]));
    await waitFor(() => expect(hook.result.current.senderName).not.toBe(reader));
    expect(hook.result.current.senderName(fromPeer)).toBe("Bình T.");
  });

  it("reads a group without a DM peer, and a room not in the list as nothing yet", async () => {
    const { wrapper } = setup();
    const hook = await renderHook(({ roomId }: { roomId: string }) => useRoomContext(chat, roomId), { wrapper, initialProps: { roomId: "g1" } });
    await waitFor(() => expect(hook.result.current.room?.id).toBe("g1"));
    expect(hook.result.current.isGroup).toBe(true);
    await hook.rerender({ roomId: "gone" });
    expect(hook.result.current.room).toBeNull();
    expect(hook.result.current.title).toBe("");
  });
});
