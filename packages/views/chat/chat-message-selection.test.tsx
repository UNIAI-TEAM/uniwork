import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatMessageActionsFrame } from "./chat-message-hover-actions";
import { ChatMessageSelectionBar } from "./chat-message-selection-bar";
import {
  ChatMessageSelectionContext,
  type ChatMessageSelectionUi,
} from "./chat-message-selection-context";
import type { ChatMessage } from "./chat-messages";

beforeAll(() => {
  initI18n();
});

function message(id: string): ChatMessage {
  return {
    id,
    roomId: "r1",
    sender: "u1",
    body: "xin chào",
    ts: 1,
    kind: "text",
    reactions: {},
  } as unknown as ChatMessage;
}

function selectionUi(overrides: Partial<ChatMessageSelectionUi> = {}): ChatMessageSelectionUi {
  return {
    active: false,
    selectedIds: new Set(),
    enter: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    copySelected: vi.fn(),
    forwardSelected: vi.fn(),
    deleteSelected: vi.fn(),
    canForwardSelected: false,
    canDeleteSelected: false,
    ...overrides,
  };
}

describe("chat message multi-select menu", () => {
  it("offers Select in the message menu", async () => {
    const enter = vi.fn();
    render(
      <ChatMessageSelectionContext.Provider value={selectionUi({ enter })}>
        <ChatMessageActionsFrame message={message("m1")} isOwn onReply={vi.fn()} onReact={vi.fn()} onCopy={vi.fn()}>
          <p>Nội dung</p>
        </ChatMessageActionsFrame>
      </ChatMessageSelectionContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByText("Nội dung"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Chọn" }));
    expect(enter).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("shows bulk actions while selection is active", async () => {
    const copySelected = vi.fn();
    render(
      <ChatMessageSelectionContext.Provider
        value={selectionUi({
          active: true,
          selectedIds: new Set(["m1"]),
          copySelected,
          canForwardSelected: true,
          canDeleteSelected: true,
        })}
      >
        <ChatMessageActionsFrame message={message("m1")} isOwn onReply={vi.fn()} onReact={vi.fn()} onCopy={vi.fn()}>
          <p>Nội dung</p>
        </ChatMessageActionsFrame>
      </ChatMessageSelectionContext.Provider>,
    );
    fireEvent.contextMenu(screen.getByText("Nội dung"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Sao chép tin đã chọn/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Chuyển tiếp tin đã chọn/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Xóa tin đã chọn/ })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Sao chép tin đã chọn/ }));
    expect(copySelected).toHaveBeenCalled();
  });
});

describe("ChatMessageSelectionBar", () => {
  it("names the count and wires bulk actions", () => {
    const onCopy = vi.fn();
    const onClear = vi.fn();
    render(
      <ChatMessageSelectionBar
        count={3}
        canForward
        canDelete
        onClear={onClear}
        onCopy={onCopy}
        onForward={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/Đã chọn 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sao chép tin đã chọn/ }));
    expect(onCopy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Bỏ chọn/ }));
    expect(onClear).toHaveBeenCalled();
  });
});
