import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageActionsFrame, ChatMessageHoverActions } from "./chat-message-hover-actions";
import type { ChatMessage } from "./chat-messages";

vi.mock("@uniwork/ui/components/common/emoji-picker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button type="button" onClick={() => onSelect("🎉")}>
      Pick 🎉
    </button>
  ),
}));

beforeAll(() => {
  initI18n();
});

const message = (id: string): ChatMessage => ({ id, sender: "@me:localhost", body: id, ts: 0, reactions: {} });

function Bar({ id }: { id: string }) {
  return (
    <ChatMessageHoverActions
      message={message(id)}
      isOwn
      onReply={vi.fn()}
      onReact={vi.fn()}
      onEdit={vi.fn()}
      onPin={vi.fn()}
    />
  );
}

describe("ChatMessageHoverActions", () => {
  it("is one tab stop per message; arrows move inside the bar", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <>
          <button type="button">before</button>
          <Bar id="m1" />
          <Bar id="m2" />
          <button type="button">after</button>
        </>,
      ),
    );
    const [first, second] = document.querySelectorAll("[data-message-actions]");
    screen.getByRole("button", { name: "before" }).focus();

    await user.tab();
    expect(first!.contains(document.activeElement)).toBe(true);
    await user.keyboard("{ArrowRight}");
    const moved = document.activeElement;
    expect(first!.contains(moved)).toBe(true);

    await user.tab();
    expect(second!.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "after" }));

    // Coming back lands on the action the arrows last moved to.
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(moved);
  });

  it("keeps the bar small: the quick heart, any emoji, reply and more", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const row: ChatMessage = { ...message("m1"), reactions: { "❤️": 2 }, myReactions: ["❤️"] };
    render(
      wrap(
        <ChatMessageHoverActions
          message={row}
          isOwn={false}
          onReply={vi.fn()}
          onReact={vi.fn()}
          onToggleReaction={onToggleReaction}
          onPin={vi.fn()}
          onThread={vi.fn()}
        />,
      ),
    );
    const bar = screen.getByRole("toolbar");
    expect(within(bar).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Thả ❤️",
      "Thêm cảm xúc",
      "Trả lời",
      "Thêm",
    ]);
    const heart = screen.getByRole("button", { name: "Thả ❤️" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await user.click(heart);
    expect(onToggleReaction).toHaveBeenCalledWith(row, "❤️");
  });

  it("puts everything else in the more menu: the reaction strip first, delete apart", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const onEdit = vi.fn();
    const row = message("m1");
    render(
      wrap(
        <ChatMessageHoverActions
          message={row}
          isOwn
          onReply={vi.fn()}
          onReact={vi.fn()}
          onToggleReaction={onToggleReaction}
          onThread={vi.fn()}
          onEdit={onEdit}
          onPin={vi.fn()}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Thêm" }));
    const menu = await screen.findByRole("menu");
    for (const emoji of ["👍", "❤️", "😂", "🎉", "😮", "🙏"]) {
      expect(within(menu).getByRole("menuitem", { name: `Thả ${emoji}` })).toBeInTheDocument();
    }
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual(
      expect.arrayContaining(["Trả lời", "Trả lời theo chủ đề", "Sửa", "Sao chép", "Ghim", "Xóa"]),
    );
    await user.click(within(menu).getByRole("menuitem", { name: "Sửa" }));
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it("opens the emoji picker from Thêm cảm xúc; a pick toggles that emoji and closes it", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    const row = message("m1");
    render(
      wrap(
        <ChatMessageHoverActions
          message={row}
          isOwn={false}
          onReply={vi.fn()}
          onReact={vi.fn()}
          onToggleReaction={onToggleReaction}
        />,
      ),
    );
    const more = screen.getByRole("button", { name: "Thêm cảm xúc" });
    // Sits in the toolbar, so the arrows reach it like any other action.
    expect(screen.getByRole("toolbar")).toContainElement(more);
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    await user.click(await screen.findByRole("button", { name: "Pick 🎉" }));
    expect(onToggleReaction).toHaveBeenCalledWith(row, "🎉");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pick 🎉" })).not.toBeInTheDocument());
  });

  it("opens the picker from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      wrap(
        <ChatMessageHoverActions
          message={message("m1")}
          isOwn
          onReply={vi.fn()}
          onReact={vi.fn()}
          onToggleReaction={vi.fn()}
        />,
      ),
    );
    screen.getByRole("button", { name: "Thêm cảm xúc" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Pick 🎉" })).toBeInTheDocument();
  });

  it("is hidden and click-through until keyboard focus, and a tap's focus does not reveal it", () => {
    render(wrap(<Bar id="m1" />));
    const classes = screen.getByRole("toolbar").className.split(/\s+/);
    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("opacity-0");
    expect(classes).not.toContain("group-focus-within/message:pointer-events-auto");
    expect(classes).toContain("group-has-[:focus-visible]/message:pointer-events-auto");
  });
});

describe("ChatMessageActionsFrame", () => {
  function Frame({ onToggleReaction = vi.fn(), pending = false }: { onToggleReaction?: () => void; pending?: boolean }) {
    return (
      <ChatMessageActionsFrame
        message={message("m1")}
        isOwn={false}
        pending={pending}
        onReply={vi.fn()}
        onReact={vi.fn()}
        onToggleReaction={onToggleReaction}
        onCopy={vi.fn()}
      >
        <p>Báo cáo doanh số tuần đã lên</p>
      </ChatMessageActionsFrame>
    );
  }

  it("opens the message's menu on a right click, reactions first", async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();
    render(wrap(<Frame onToggleReaction={onToggleReaction} />));
    fireEvent.contextMenu(screen.getByText("Báo cáo doanh số tuần đã lên"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Sao chép" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Thả 🎉" }));
    expect(onToggleReaction).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), "🎉");
  });

  it("opens the bar's emoji picker from the menu's Thêm cảm xúc", async () => {
    const user = userEvent.setup();
    render(wrap(<Frame />));
    fireEvent.contextMenu(screen.getByText("Báo cáo doanh số tuần đã lên"));
    await user.click(await screen.findByRole("menuitem", { name: "Thêm cảm xúc" }));
    expect(await screen.findByRole("button", { name: "Pick 🎉" })).toBeInTheDocument();
  });

  it("leaves a message not on the server yet without actions", () => {
    render(wrap(<Frame pending />));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("Báo cáo doanh số tuần đã lên"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
