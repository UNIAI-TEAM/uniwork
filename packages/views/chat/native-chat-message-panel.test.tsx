import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { wrap } from "../test/api-mock";
import { NativeChatMessagePanel } from "./native-chat-message-panel";

const toggleReaction = vi.fn().mockResolvedValue(undefined);
const deleteMessage = vi.fn();
const editMessage = vi.fn();

type Row = {
  id: string;
  sender_id: string;
  body: string;
  kind: string;
  created_at: string;
  reply_to_message_id?: string;
  reactions: Record<string, number>;
  my_reactions?: string[];
};

const BASE_ROWS: Row[] = [
  {
    id: "m1",
    sender_id: "u2",
    body: "Hi team",
    kind: "text",
    created_at: "2026-01-01T10:00:00.000Z",
    reactions: {},
  },
  {
    id: "m2",
    sender_id: "self",
    body: "Reply",
    kind: "text",
    created_at: "2026-01-01T10:01:00.000Z",
    reply_to_message_id: "m1",
    reactions: { "👍": 1 },
    my_reactions: ["👍"],
  },
];
let rows: Row[] = BASE_ROWS;

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useChatRoomMessages: () => ({ data: rows, isPending: false }),
  useToggleChatReaction: () => ({ mutateAsync: toggleReaction }),
  useDeleteChatMessage: () => ({ mutateAsync: deleteMessage, isPending: false }),
  useEditChatMessage: () => ({ mutateAsync: editMessage, isPending: false }),
}));

vi.mock("@uniwork/core/api/endpoints/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/chat")>()),
  listChatRoomMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import { toast } from "sonner";

// @tanstack/react-virtual needs layout measurements that jsdom cannot provide,
// so render rows synchronously in this test.
vi.mock("./virtual-chat-message-list", () => ({
  updateStickToBottomFromScroll: () => true,
  VirtualChatMessageList: ({ messages, header, empty, renderMessage }: any) => (
    <>
      {header}
      {messages.length === 0 ? empty : messages.map((_: unknown, index: number) => renderMessage(index))}
    </>
  ),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  rows = BASE_ROWS;
  deleteMessage.mockReset();
  editMessage.mockReset();
  vi.mocked(toast.error).mockReset();
});

function panel(props: Partial<Parameters<typeof NativeChatMessagePanel>[0]> = {}) {
  return (
    <NativeChatMessagePanel
      workspaceId="ws1"
      roomId="room1"
      currentUserId="self"
      nameContext={NAMES}
      emptyLabel="No messages"
      youLabel="Bạn"
      replyTo={null}
      onReplyToChange={vi.fn()}
      {...props}
    />
  );
}
const NAMES = [{ user_id: "u2", display_name: "Binh" }];

const IDS: Record<string, string> = { "Hi team": "m1", Reply: "m2" };

function messageArticle(text: string): HTMLElement {
  const article = document.getElementById(`chat-msg-${IDS[text] ?? ""}`);
  if (!article) throw new Error(`no article for ${text}`);
  return article;
}

describe("NativeChatMessagePanel", () => {
  it("renders messages and clears an active reply, handing focus back to the composer", () => {
    const onReplyToChange = vi.fn();
    const onFocusComposer = vi.fn();
    const replyTo = {
      id: "m1",
      sender: "u2",
      body: "Hi team",
      ts: Date.parse("2026-01-01T10:00:00.000Z"),
      reactions: {},
    };

    render(wrap(panel({ replyTo, onReplyToChange, onFocusComposer })));

    expect(screen.getAllByText("Hi team").length).toBeGreaterThan(0);
    expect(screen.getByText("Reply")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onReplyToChange).toHaveBeenCalledWith(null);
    expect(onFocusComposer).toHaveBeenCalled();
  });

  it("names every message's sender and time, mine as “Bạn”, and keeps the list silent", () => {
    render(wrap(panel()));
    const mine = messageArticle("Reply");
    expect(mine).toHaveAccessibleName(/^Bạn, /);
    expect(messageArticle("Hi team")).toHaveAccessibleName(/^Binh, /);
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "off");
  });

  it("marks my own reaction as pressed", () => {
    render(wrap(panel()));
    const chip = within(messageArticle("Reply")).getByRole("button", { name: /👍, 1 lượt thả, có bạn/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("focuses the composer after Reply", async () => {
    const onFocusComposer = vi.fn();
    const onReplyToChange = vi.fn();
    render(wrap(panel({ onFocusComposer, onReplyToChange })));
    fireEvent.click(within(messageArticle("Hi team")).getByRole("button", { name: "Trả lời" }));
    expect(onReplyToChange).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(onFocusComposer).toHaveBeenCalled();
  });

  it("asks before deleting and says so when the delete fails", async () => {
    const user = userEvent.setup();
    deleteMessage.mockRejectedValueOnce(new ApiError("forbidden", "forbidden", 403));
    render(wrap(panel()));

    await user.click(within(messageArticle("Reply")).getByRole("button", { name: "Thêm" }));
    await user.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    expect(deleteMessage).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Xóa tin nhắn này?");
    await user.click(within(dialog).getByRole("button", { name: "Xóa" }));

    expect(deleteMessage).toHaveBeenCalledWith({ roomId: "room1", messageId: "m2" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Bạn không có quyền làm việc này."));
  });

  it("keeps the edit dialog open with the error inside it when saving fails", async () => {
    const user = userEvent.setup();
    editMessage.mockRejectedValueOnce(new Error("boom"));
    render(wrap(panel()));

    await user.click(within(messageArticle("Reply")).getByRole("button", { name: "Sửa" }));
    const field = await screen.findByRole("textbox", { name: "Sửa tin nhắn" });
    await user.clear(field);
    await user.type(field, "Reply edited");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(editMessage).toHaveBeenCalledWith({ roomId: "room1", messageId: "m2", body: "Reply edited" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa lưu được thay đổi. Thử lại.");
    expect(screen.getByRole("textbox", { name: "Sửa tin nhắn" })).toHaveValue("Reply edited");
  });

  it("does not save an edit that changed nothing", async () => {
    const user = userEvent.setup();
    render(wrap(panel()));
    await user.click(within(messageArticle("Reply")).getByRole("button", { name: "Sửa" }));
    await user.click(await screen.findByRole("button", { name: "Lưu" }));
    expect(editMessage).not.toHaveBeenCalled();
  });

  it("announces a new message from someone else at the bottom, and nothing else", () => {
    const { rerender } = render(wrap(panel()));
    const status = () => screen.getAllByRole("status").find((node) => node.getAttribute("aria-live") === "polite");
    expect(status()?.textContent).toBe("");

    // History loading above is not news.
    rows = [
      {
        id: "m0",
        sender_id: "u2",
        body: "Older",
        kind: "text",
        created_at: "2026-01-01T09:00:00.000Z",
        reactions: {},
      },
      ...BASE_ROWS,
    ];
    act(() => rerender(wrap(panel())));
    expect(status()?.textContent).toBe("");

    rows = [
      ...rows,
      {
        id: "m3",
        sender_id: "u2",
        body: "Mới đây",
        kind: "text",
        created_at: "2026-01-01T10:05:00.000Z",
        reactions: {},
      },
    ];
    act(() => rerender(wrap(panel())));
    expect(status()?.textContent).toBe("Binh: Mới đây");
  });

  it("offers a button for older history when more exists", () => {
    rows = Array.from({ length: 80 }, (_, i) => ({
      id: `h${i}`,
      sender_id: "u2",
      body: `msg ${i}`,
      kind: "text",
      created_at: new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString(),
      reactions: {},
    }));
    render(wrap(panel()));
    expect(screen.getByRole("button", { name: "Tải tin cũ hơn" })).toBeInTheDocument();
  });
});
