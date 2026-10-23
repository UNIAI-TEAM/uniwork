// The conversation lifted above a room row's long-press menu (room-preview.tsx):
// the row's title and unread count, then the room's latest messages oldest
// first, each sender named once per run in a group, never in a DM, own
// messages on the right. Read-only: hidden from screen readers (the menu is
// what they reach), and it never asks to mark the room read.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { QueryClient } from "@tanstack/react-query";
import { configure, screen } from "@testing-library/react-native";
import { chatApi } from "@/data/chat-api";
import { chatKeys } from "@/data/queries/chat-keys";
import type { RoomListRow } from "@/lib/room-list";
import { render, viText } from "@/test/render";
import { RoomPreview } from "./room-preview";

jest.mock("@/data/chat-api", () => ({ chatApi: { listMessages: jest.fn() } }));

const record = (id: string, sender: string, body: string, minute: number) =>
  ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: sender,
    sender_display_name: sender === "u1" ? "An" : sender === "u2" ? "Bình" : "Chi",
    body,
    created_at: `2026-10-22T02:${String(minute).padStart(2, "0")}:00Z`,
  });

function row(extra: Partial<RoomListRow> = {}): RoomListRow {
  return {
    key: "room:r1",
    entry: {} as RoomListRow["entry"],
    roomId: "r1",
    room: null,
    title: "Team Alpha",
    mark: { kind: "group" },
    prefix: null,
    subtitle: null,
    typing: false,
    missed: false,
    seen: false,
    time: null,
    unread: 0,
    mentionUnread: 0,
    muted: false,
    pinned: false,
    ...extra,
  };
}

function client(messages: ReturnType<typeof record>[] | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  if (messages) queryClient.setQueryData(chatKeys.roomPreview("w1", "r1"), messages);
  return queryClient;
}

// The whole preview is hidden from screen readers on purpose; read it the way a sighted person does.
beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
afterAll(() => configure({ defaultIncludeHiddenElements: false }));

describe("RoomPreview", () => {
  it("is hidden from screen readers: the menu under it is what they reach", async () => {
    await render(<RoomPreview wsId="w1" row={row()} userId="u1" />, { queryClient: client([]) });
    expect(screen.queryByText("Team Alpha", { includeHiddenElements: false })).toBeNull();
  });

  it("shows the latest four, oldest first, naming each run's sender once in a group", async () => {
    const messages = [
      record("m5", "u1", "Mine", 5),
      record("m4", "u2", "Second from Bình", 4),
      record("m3", "u2", "First from Bình", 3),
      record("m2", "u3", "From Chi", 2),
      record("m1", "u3", "Too old to show", 1),
    ];
    await render(<RoomPreview wsId="w1" row={row({ unread: 120 })} userId="u1" />, { queryClient: client(messages) });
    expect(screen.getByText("Team Alpha")).toBeOnTheScreen();
    expect(screen.getByText("99+")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.unread_count_chip", { count: 120 }))).toBeOnTheScreen();
    expect(screen.queryByText("Too old to show")).toBeNull();
    expect(screen.getAllByText("Bình")).toHaveLength(1);
    expect(screen.getByText("Chi")).toBeOnTheScreen();
    expect(screen.queryByText("An")).toBeNull();
    expect(screen.getByText("Mine")).toBeOnTheScreen();
    expect(chatApi.listMessages).not.toHaveBeenCalled();
  });

  it("names nobody in a DM and shows a small unread count as it is", async () => {
    await render(<RoomPreview wsId="w1" row={row({ unread: 3, mark: { kind: "dm", label: "Bình", online: false } })} userId="u1" />, {
      queryClient: client([record("m1", "u2", "Hello", 1)]),
    });
    expect(screen.getByText("3")).toBeOnTheScreen();
    expect(screen.getByText("Hello")).toBeOnTheScreen();
    expect(screen.queryByText("Bình")).toBeNull();
  });

  it("asks for nothing for a DM that does not exist yet, and shows only the head", async () => {
    await render(<RoomPreview wsId="w1" row={row({ roomId: null, key: "dm:u2" })} userId="u1" />, { queryClient: client(undefined) });
    expect(screen.getByText("Team Alpha")).toBeOnTheScreen();
    expect(chatApi.listMessages).not.toHaveBeenCalled();
  });
});
