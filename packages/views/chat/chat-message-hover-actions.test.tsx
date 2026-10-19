import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
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

  it("leads with six quick reactions that toggle that emoji, mine drawn pressed", async () => {
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
        />,
      ),
    );
    for (const emoji of ["👍", "❤️", "😂", "🎉", "😮", "🙏"]) {
      // One button per emoji: the quick 👍 replaces the old single "Thả 👍" action.
      expect(screen.getAllByRole("button", { name: `Thả ${emoji}` })).toHaveLength(1);
    }
    const heart = screen.getByRole("button", { name: "Thả ❤️" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Thả 🎉" }));
    expect(onToggleReaction).toHaveBeenCalledWith(row, "🎉");
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
});
