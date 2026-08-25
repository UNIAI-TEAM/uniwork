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
});
