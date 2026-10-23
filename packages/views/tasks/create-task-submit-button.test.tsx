import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createShortcutChord } from "@uniwork/core/shortcuts";
import { CreateTaskSubmitButton } from "./create-task-submit-button";

describe("CreateTaskSubmitButton", () => {
  it("keeps manual and agent actions on the same visual contract", () => {
    const shortcut = createShortcutChord("Enter", { primary: true });
    const { rerender } = render(
      <CreateTaskSubmitButton
        type="submit"
        label="Tạo"
        shortcut={shortcut}
        inactive={false}
        busy={false}
      />,
    );

    const manualButton = screen.getByRole("button", { name: "Tạo" });
    const sharedClasses = ["h-7", "min-w-28", "justify-self-end", "gap-2"];
    expect(manualButton).toHaveClass(...sharedClasses);
    expect(manualButton.querySelector('[data-slot="shortcut-keycaps"]')).toHaveClass(
      "ml-1",
      "max-sm:hidden",
    );

    rerender(
      <CreateTaskSubmitButton
        type="button"
        label="Gửi cho agent"
        shortcut={shortcut}
        inactive={false}
        busy={false}
      />,
    );

    const agentButton = screen.getByRole("button", { name: "Gửi cho agent" });
    expect(agentButton).toHaveClass(...sharedClasses);
    expect(agentButton.querySelector('[data-slot="shortcut-keycaps"]')).toHaveClass(
      "ml-1",
      "max-sm:hidden",
    );
  });

  it("keeps an unavailable action focusable while blocking activation", () => {
    const onClick = vi.fn();
    render(
      <CreateTaskSubmitButton
        type="button"
        label="Gửi cho agent"
        shortcut={null}
        inactive
        busy={false}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Gửi cho agent" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
