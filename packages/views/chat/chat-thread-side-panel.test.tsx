import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatThreadSidePanel } from "./chat-thread-side-panel";

const ROWS = [
  { id: "m1", sender_id: "u2", body: "Kịch bản bản 2", kind: "text", created_at: "2026-01-01T10:00:00.000Z", reactions: {} },
  {
    id: "m2",
    sender_id: "self",
    body: "Cắt còn 30 giây",
    kind: "text",
    created_at: "2026-01-01T10:01:00.000Z",
    thread_root_id: "m1",
    reactions: {},
  },
];

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useChatRoomMessages: () => ({ data: ROWS, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useChatThreadMessages: () => ({ data: ROWS, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useMarkChatRoomReadAtLatest: () => undefined,
  useChatGifs: () => ({ data: [], isFetching: false }),
  useChatStickers: () => ({ data: [], isFetching: false }),
}));

vi.mock("./virtual-chat-message-list", () => ({
  updateStickToBottomFromScroll: () => true,
  VirtualChatMessageList: ({ messages, renderMessage }: { messages: unknown[]; renderMessage: (i: number) => unknown }) => (
    <>{messages.map((_, index) => renderMessage(index))}</>
  ),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  // The draft store keeps text only for a signed-in person.
  setSessionUser({
    id: "self",
    email: "self@x.vn",
    display_name: "Self",
    onboarded_at: null,
    email_verified_at: null,
    onboarding_questionnaire: {},
    locale: "vi",
    has_password: true,
  });
  useChatComposerDraftStore.setState({ drafts: {} });
});

const ROOT = { id: "m1", sender: "u2", body: "Kịch bản bản 2", ts: Date.parse("2026-01-01T10:00:00.000Z") } as unknown as ChatMessage;

function renderPanel(overrides: Partial<Parameters<typeof ChatThreadSidePanel>[0]> = {}) {
  const props = {
    workspaceId: "ws1",
    roomId: "room1",
    root: ROOT,
    roomTitle: "Ra mắt UniWork Q4",
    currentUserId: "self",
    nameContext: [{ user_id: "u2", display_name: "Võ Minh" }],
    canPinMessages: true,
    canModerate: false,
    canSendMessages: true,
    onClose: vi.fn(),
    draftKey: "ws1:group:g1:thread:m1",
    onSendReply: vi.fn(),
    onSendMedia: vi.fn(),
    composerDisabled: false,
    readOnlyPlaceholder: "",
    memberAvatarByUserId: {},
    ...overrides,
  };
  render(wrap(<ChatThreadSidePanel {...props} />));
  return props;
}

describe("ChatThreadSidePanel", () => {
  it("shows the thread with the room's name and replies from its own field into the thread", () => {
    const props = renderPanel();
    const panel = screen.getByRole("complementary", { name: "Chủ đề" });
    expect(within(panel).getByText("Ra mắt UniWork Q4")).toBeInTheDocument();
    expect(within(panel).getByText("Cắt còn 30 giây")).toBeInTheDocument();

    const field = within(panel).getByRole("textbox", { name: "Trả lời trong chủ đề…" });
    fireEvent.change(field, { target: { value: "Đồng ý" } });
    expect(useChatComposerDraftStore.getState().drafts["ws1:group:g1:thread:m1"]).toBe("Đồng ý");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.onSendReply).toHaveBeenCalledWith("ws1:group:g1:thread:m1", "m1");
  });

  it("edits my reply in its own field, and closing hands back to the page", () => {
    const props = renderPanel();
    const panel = screen.getByRole("complementary", { name: "Chủ đề" });
    fireEvent.click(within(document.getElementById("chat-msg-m2")!).getByRole("button", { name: "Sửa" }));
    expect(within(panel).getByRole("textbox", { name: "Sửa tin nhắn" })).toHaveValue("Cắt còn 30 giây");

    fireEvent.click(within(panel).getByRole("button", { name: "Đóng chủ đề" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
