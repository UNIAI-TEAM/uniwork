// A conversation before and without its history (audit UX P1): the first page
// loads behind bubble shapes, a failed first page says so with a retry and
// never shows the empty room's "start chatting" copy (a reader would think the
// history is gone), a failed thread does the same, and a failed older page
// offers its own retry at the top of the list.
import "react-native-gesture-handler/jestSetup";
import { ChatMessageSchema, ChatRoomSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { chatApi } from "@/data/chat-api";
import { toTimelineMessage, type TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { Conversation } from "./conversation";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useRoomContext } from "./use-room-context";

jest.mock("./connection-banner", () => ({ ConnectionBanner: () => null }));
jest.mock("./swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: ReactNode }) => children }));
jest.mock("./use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };

interface Props {
  messages?: TimelineMessage[];
  loading?: boolean;
  thread?: boolean;
  onRetryLoad?: () => void;
  loadingOlder?: boolean;
  onRetryOlder?: () => void;
}

function Screen({ messages = [], loading = false, thread = false, onRetryLoad, loadingOlder = false, onRetryOlder }: Props) {
  const room = useRoomContext(chat, "r1");
  return (
    <Conversation
      chat={chat}
      roomId="r1"
      threadRootId={thread ? "root" : undefined}
      room={room}
      header={null}
      messages={messages}
      loading={loading}
      onRetryLoad={onRetryLoad}
      loadingOlder={loadingOlder}
      onRetryOlder={onRetryOlder}
      jumpTo={null}
      onQuoteJump={jest.fn()}
      onAtLatestChange={jest.fn()}
    />
  );
}

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

beforeEach(() => {
  const dm = ChatRoomSchema.parse({ id: "r1", kind: "dm", name: "", workspace_id: "w1", member_count: 2, member_user_ids: ["ME", "U2"], peer_user_id: "U2", peer_display_name: "Bình" });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([dm]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listFollowUps").mockResolvedValue([]);
  jest.spyOn(chatApi, "listRoomMessageLinks").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

const emptyCopy = () => screen.queryByText(new RegExp(viText("chat.dm_empty", { name: "" }).slice(0, 12)));

describe("a conversation's first page", () => {
  it("loads behind bubble shapes, read as one loading element", async () => {
    await render(<Screen loading />);
    await settle();
    expect(screen.getByRole("progressbar", { name: viText("common.loading") })).toBeOnTheScreen();
    expect(screen.queryByTestId("message-list")).toBeNull();
  });

  it("that failed says so and retries, never the empty room's copy", async () => {
    const onRetryLoad = jest.fn();
    await render(<Screen onRetryLoad={onRetryLoad} />);
    await settle();
    expect(screen.getByText(viText("mobile.conversation.load_failed"))).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.conversation.load_failed_hint"))).toBeOnTheScreen();
    expect(emptyCopy()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: viText("common.retry") }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it("is the empty room's copy only when the room really has no message", async () => {
    await render(<Screen />);
    await settle();
    expect(await screen.findByText(viText("chat.dm_empty", { name: "Bình" }))).toBeOnTheScreen();
  });

  it("of a thread that failed names the thread", async () => {
    await render(<Screen thread onRetryLoad={jest.fn()} />);
    await settle();
    expect(screen.getByText(viText("mobile.conversation.thread_load_failed"))).toBeOnTheScreen();
  });
});

describe("older pages", () => {
  const messages = [toTimelineMessage(ChatMessageSchema.parse({ id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "U2", sender_display_name: "Bình", kind: "text", body: "xin chào", created_at: "2026-10-21T02:00:00Z" }))];

  it("say they are loading", async () => {
    await render(<Screen messages={messages} loadingOlder />);
    await settle();
    expect(screen.getByLabelText(viText("chat.loading_older"))).toBeOnTheScreen();
  });

  it("that failed offer a retry at the top of the list", async () => {
    const onRetryOlder = jest.fn();
    await render(<Screen messages={messages} onRetryOlder={onRetryOlder} />);
    await settle();
    await fireEvent.press(screen.getByTestId("conversation-older-retry"));
    expect(onRetryOlder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: `${viText("mobile.conversation.older_load_failed")}. ${viText("common.retry")}` })).toBeOnTheScreen();
  });
});
