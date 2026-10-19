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
  it("takes no pointer events while hidden and is not revealed by a tap's focus or by hover on a phone", () => {
    render(wrap(<Bar id="m1" />));
    const classes = screen.getByRole("toolbar").className.split(/\s+/);
    // Hidden: it must not sit over the card's title and swallow the tap (F-01).
    expect(classes).toContain("pointer-events-none");
    expect(classes).toContain("opacity-0");
    // A tap focuses the title, so plain focus-within must not reveal the bar;
    // keyboard focus (focus-visible) still does.
    expect(classes).not.toContain("group-focus-within/message:pointer-events-auto");
    expect(classes).toContain("group-has-[:focus-visible]/message:pointer-events-auto");
    // Hover reveals it from sm up only, where the bar is beside the bubble.
    expect(classes).not.toContain("group-hover/message:pointer-events-auto");
    expect(classes).toContain("sm:group-hover/message:pointer-events-auto");
  });

  it("opens on a long press (forceOpen) with pointer events on", () => {
    render(
      wrap(
        <ChatMessageHoverActions message={message("m1")} isOwn onReply={vi.fn()} onReact={vi.fn()} forceOpen />,
      ),
    );
    const classes = screen.getByRole("toolbar").className.split(/\s+/);
    expect(classes).toContain("pointer-events-auto");
    expect(classes).toContain("opacity-100");
  });
});
