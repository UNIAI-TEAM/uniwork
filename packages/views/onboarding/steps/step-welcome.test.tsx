import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { StepWelcome } from "./step-welcome";

initI18n();

describe("StepWelcome", () => {
  it("shows headline and start CTA; skip only when provided", () => {
    const onNext = vi.fn();
    const { rerender } = render(<StepWelcome onNext={onNext} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("một không gian.");
    expect(screen.queryByRole("button", { name: "Tôi đã dùng rồi" })).toBeNull();
    screen.getByRole("button", { name: /Bắt đầu/ }).click();
    expect(onNext).toHaveBeenCalled();
    rerender(<StepWelcome onNext={onNext} onSkip={() => {}} />);
    expect(screen.getByRole("button", { name: "Tôi đã dùng rồi" })).toBeInTheDocument();
  });

  it("keeps the page to the screen's width at large text", () => {
    render(<StepWelcome onNext={() => {}} />);
    const heading = screen.getByRole("heading", { level: 1 });
    // The single column below lg is minmax(0, 1fr), not `auto`: an auto track
    // grows to the plan card's min-content and carries the headline past the
    // right edge of a phone at 200% text.
    const grid = heading.closest(".grid");
    expect(grid).toHaveClass("grid-cols-[minmax(0,1fr)]");
    expect(heading).toHaveClass("wrap-break-word");
    // The plan card stacks each step when it is that narrow, rather than
    // squeezing the step's words into a sliver beside its tile.
    const plan = screen.getByRole("list");
    expect(plan.parentElement).toHaveClass("@container/plan");
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("@max-[10rem]/plan:flex-col");
    }
  });
});
