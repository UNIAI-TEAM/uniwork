// Render counts for a conversation (audit H1/H3): what a typing frame, a
// presence change, a new message and a reaction cost in message rows. Each row
// drawing its content is counted through MessageContent, which only a row that
// renders reaches. A regression that makes rows redraw shows up here as a count,
// in the component job of mobile-verify.yml, before anyone feels it on a phone.
import { useState } from "react";
import { ChatMessageSchema, ChatRoomSchema, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { chatApi } from "@/data/chat-api";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import { toTimelineMessage, type TimelineMessage } from "@/lib/timeline-display";
import { render } from "@/test/render";
import { Conversation } from "./conversation";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useRoomContext } from "./use-room-context";

const mockRenders = new Map<string, number>();
jest.mock("./message-cards", () => {
  const actual = jest.requireActual<typeof import("./message-cards")>("./message-cards");
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    MessageContent: ({ record }: { record: ChatMessageRecord }): ReactNode => {
      mockRenders.set(record.id, (mockRenders.get(record.id) ?? 0) + 1);
      return <Text>{record.body}</Text>;
    },
  };
});
jest.mock("./connection-banner", () => ({ ConnectionBanner: () => null }));
// The swipe is a gesture wrapper, not what is counted; its worklets need the native runtime.
jest.mock("./swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: ReactNode }) => children }));
jest.mock("./use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const T0 = Date.UTC(2026, 9, 21, 2, 0);

const record = (id: string, sender: string, minute: number, extra: Record<string, unknown> = {}) =>
  ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: sender,
    sender_display_name: sender,
    kind: "text",
    body: `message ${id}`,
    created_at: new Date(T0 + minute * 60_000).toISOString(),
    ...extra,
  });

// Two people talking in turns, each message its own run: twelve rows.
const history = Array.from({ length: 12 }, (_, i) => record(`m${String(i).padStart(2, "0")}`, i % 2 ? "ME" : "U2", i * 10));

function Screen({ records }: { records: ChatMessageRecord[] }) {
  const room = useRoomContext(chat, "r1");
  // The screen owns whether the list shows its newest message, as the room and thread screens do.
  const [atLatest, setAtLatest] = useState(true);
  const messages: TimelineMessage[] = records.map(toTimelineMessage);
  return (
    <Conversation
      chat={chat}
      roomId="r1"
      room={room}
      header={null}
      messages={messages}
      loading={false}
      loadingOlder={false}
      jumpTo={null}
      onQuoteJump={jest.fn()}
      atLatest={atLatest}
      onAtLatestChange={setAtLatest}
    />
  );
}

/** Row renders since the last call, by message id. */
const take = () => {
  const counts = Object.fromEntries(mockRenders);
  mockRenders.clear();
  return counts;
};

beforeEach(() => {
  mockRenders.clear();
  const group = ChatRoomSchema.parse({ id: "r1", kind: "group", name: "Thiết kế", workspace_id: "w1", member_count: 2, member_user_ids: ["ME", "U2"] });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([group]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listFollowUps").mockResolvedValue([]);
  jest.spyOn(chatApi, "listRoomMessageLinks").mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => {
    useSidebarTypingStore.getState().clearAll();
    usePresenceStore.getState().clearAll();
  });
  jest.restoreAllMocks();
});

/** The room, its members and the task links answer, and the list draws its next batch: the screen as a person sees it. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("Conversation render counts", () => {
  it("a typing frame or a presence change redraws no message row", async () => {
    await render(<Screen records={history} />);
    await settle();
    expect(Object.keys(take()).length).toBeGreaterThan(0);

    await act(async () => useSidebarTypingStore.getState().bump("r1", "U2", "ME"));
    expect(screen.getByLabelText("U2 đang nhập…")).toBeOnTheScreen();
    await act(async () => usePresenceStore.getState().bump("U2", "ME"));
    expect(take()).toEqual({});
  });

  it("a new message draws that row only; a reaction redraws the row it lands on only", async () => {
    const { rerender } = await render(<Screen records={history} />);
    await settle();
    take();

    const next = [...history, record("m12", "U2", 200)];
    await rerender(<Screen records={next} />);
    await settle();
    expect(take()).toEqual({ m12: 1 });

    const reacted = next.map((m) => (m.id === "m11" ? { ...m, reactions: { "👍": 1 } } : m));
    await rerender(<Screen records={reacted} />);
    await settle();
    expect(take()).toEqual({ m11: 1 });
  });

  // The links of a window are asked again when its ids change (lib/link-windows.ts); the cards it had
  // stay on screen, and their rows stay as drawn, until the answer comes (audit S5 review P2).
  describe("task cards while a window's links refetch", () => {
    const link = (messageId: string) => ({
      id: `l-${messageId}`,
      message_id: messageId,
      target_type: "task",
      target_id: `t-${messageId}`,
      relation: "created_from",
    });
    const never = () => new Promise<never>(() => undefined);

    beforeEach(() => {
      jest.spyOn(chatApi, "getTask").mockImplementation(async (id: string) => ({ id, title: `Task ${id}`, identifier: "UNI-1", status: "todo" }) as never);
    });

    it("a new message keeps the newest window's cards and redraws only the new row", async () => {
      // m09–m11 are the newest window (m08 closes the one before it); m12 joins it.
      const links = jest.spyOn(chatApi, "listRoomMessageLinks").mockImplementation(async (_ws, _room, ids) => (ids.includes("m10") ? [link("m10")] : []));
      const { rerender } = await render(<Screen records={history} />);
      await settle();
      expect(screen.getAllByTestId("message-task-card")).toHaveLength(1);
      take();

      links.mockImplementation((_ws, _room, ids) => (ids.includes("m12") ? never() : Promise.resolve([])));
      await rerender(<Screen records={[...history, record("m12", "U2", 200)]} />);
      await settle();
      expect(links).toHaveBeenLastCalledWith("w1", "r1", ["m09", "m10", "m11", "m12"]);
      expect(screen.getAllByTestId("message-task-card")).toHaveLength(1);
      expect(take()).toEqual({ m12: 1 });
    });

    it("an older page keeps the cards of the window it joins", async () => {
      const links = jest.spyOn(chatApi, "listRoomMessageLinks").mockImplementation(async (_ws, _room, ids) => (ids.includes("m03") ? [link("m03")] : []));
      const { rerender } = await render(<Screen records={history} />);
      await settle();
      expect(screen.getAllByTestId("message-task-card")).toHaveLength(1);

      // k00–k03 hash to no window end, so they join m00–m08 under a new key.
      links.mockImplementation((_ws, _room, ids) => (ids.includes("k00") ? never() : Promise.resolve([])));
      const older = ["k00", "k01", "k02", "k03"].map((id, i) => record(id, "U2", -40 + i));
      await rerender(<Screen records={[...older, ...history]} />);
      await settle();
      expect(links).toHaveBeenLastCalledWith("w1", "r1", ["k00", "k01", "k02", "k03", "m00", "m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08"]);
      expect(screen.getAllByTestId("message-task-card")).toHaveLength(1);
    });

    it("a window's answer replaces what was kept: a task unlinked meanwhile goes", async () => {
      const links = jest.spyOn(chatApi, "listRoomMessageLinks").mockImplementation(async (_ws, _room, ids) => (ids.includes("m10") ? [link("m10")] : []));
      const { rerender } = await render(<Screen records={history} />);
      await settle();
      expect(screen.getAllByTestId("message-task-card")).toHaveLength(1);

      links.mockResolvedValue([]);
      await rerender(<Screen records={[...history, record("m12", "U2", 200)]} />);
      await settle();
      expect(screen.queryAllByTestId("message-task-card")).toHaveLength(0);
    });
  });
});
