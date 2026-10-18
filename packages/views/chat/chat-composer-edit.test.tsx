import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatComposer, type ChatComposerEditing } from "./chat-composer";

initI18n();

vi.mock("@uniwork/core/chat", () => ({
  useChatGifs: () => ({ data: [], isFetching: false }),
  useChatStickers: () => ({ data: [], isFetching: false }),
}));

vi.mock("./chat-sticker-packs", () => ({
  loadChatStickerPacks: vi.fn().mockResolvedValue([]),
  filterStickerPacks: (packs: unknown[]) => packs,
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

/** A composer whose draft is real state, with edit mode switched from outside like the page does. */
function Harness({ editing, onSend = vi.fn() }: { editing: ChatComposerEditing | null; onSend?: () => void }) {
  const [draft, setDraft] = useState("bản nháp dở");
  return (
    <ChatComposer
      workspaceId="ws1"
      draft={draft}
      onDraftChange={setDraft}
      onSend={onSend}
      onSendFile={vi.fn()}
      placeholder="Nhập tin nhắn…"
      sendLabel="Gửi"
      editing={editing}
    />
  );
}

function editingOf(overrides: Partial<ChatComposerEditing> = {}): ChatComposerEditing {
  return {
    message: { id: "m2", body: "Tin gốc" },
    saving: false,
    error: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("ChatComposer edit mode", () => {
  it("prefills the field with the message, shows the edit bar and saves with Enter through the check button's action", () => {
    const editing = editingOf();
    const onSend = vi.fn();
    render(wrap(<Harness editing={editing} onSend={onSend} />));

    expect(screen.getByText("Đang sửa tin nhắn")).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Sửa tin nhắn" });
    expect(field).toHaveValue("Tin gốc");
    // Attachments and voice are not part of an edit.
    expect(screen.getByLabelText("Đính kèm")).toBeDisabled();
    expect(screen.queryByLabelText("Ghi âm tin nhắn thoại")).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: "Tin đã sửa" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(editing.onSave).toHaveBeenCalledWith("Tin đã sửa");
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(editing.onSave).toHaveBeenCalledTimes(2);
  });

  it("cancels with Esc or the bar's X, and the draft from before is back", () => {
    const editing = editingOf();
    const { rerender } = render(wrap(<Harness editing={editing} />));
    const field = screen.getByRole("textbox", { name: "Sửa tin nhắn" });
    fireEvent.change(field, { target: { value: "đang sửa" } });

    fireEvent.keyDown(field, { key: "Escape" });
    expect(editing.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Hủy sửa" }));
    expect(editing.onCancel).toHaveBeenCalledTimes(2);

    rerender(wrap(<Harness editing={null} />));
    expect(screen.getByRole("textbox", { name: "Nhập tin nhắn…" })).toHaveValue("bản nháp dở");

    // Editing the same message again starts from its text, not the abandoned edit.
    rerender(wrap(<Harness editing={editing} />));
    expect(screen.getByRole("textbox", { name: "Sửa tin nhắn" })).toHaveValue("Tin gốc");
  });

  it("keeps the text and says why when a save failed, and cannot save an empty message", () => {
    render(wrap(<Harness editing={editingOf({ error: "Chưa lưu được thay đổi. Thử lại." })} />));
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa lưu được thay đổi. Thử lại.");

    fireEvent.change(screen.getByRole("textbox", { name: "Sửa tin nhắn" }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
  });
});

describe("ChatComposer text-only (thread reply)", () => {
  it("has no attach menu and no voice: an empty field shows a disabled send", () => {
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          placeholder="Trả lời trong chủ đề…"
          sendLabel="Gửi"
          textOnly
        />,
      ),
    );
    expect(screen.queryByLabelText("Đính kèm")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ghi âm tin nhắn thoại")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi" })).toBeDisabled();
  });
});

describe("ChatComposer reply", () => {
  it("heads the pill with the quoted message, and its X cancels the reply and keeps the caret in the field", () => {
    const onCancelReply = vi.fn();
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
          replyTo={{ id: "m1", sender: "u2", body: "Bản banner cuối", ts: 0, reactions: {} }}
          replyToSenderLabel="Hoàng Lan"
          onCancelReply={onCancelReply}
        />,
      ),
    );
    expect(screen.getByText("Trả lời Hoàng Lan")).toBeInTheDocument();
    expect(screen.getByText("Bản banner cuối")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Nhập tin nhắn…" })).toHaveFocus();
  });
});
