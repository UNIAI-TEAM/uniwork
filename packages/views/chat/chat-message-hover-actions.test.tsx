import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import type { ChatMessage } from "./chat-messages";

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
    const [first, second] = screen.getAllByRole("toolbar");
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
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏"]) {
      // One button per emoji: the quick 👍 replaces the old single "Thả 👍" action.
      expect(screen.getAllByRole("button", { name: `Thả ${emoji}` })).toHaveLength(1);
    }
    const heart = screen.getByRole("button", { name: "Thả ❤️" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Thả 😢" }));
    expect(onToggleReaction).toHaveBeenCalledWith(row, "😢");
  });
});

