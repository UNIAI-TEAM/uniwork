import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActorAvatar } from "./actor-avatar";

describe("ActorAvatar status dot", () => {
  it("draws no dot without a status", () => {
    const { container } = render(<ActorAvatar name="An" initials="A" />);
    expect(container.querySelector("[data-slot='avatar-status']")).toBeNull();
  });

  it.each([
    ["success", "bg-success-solid"],
    ["warning", "bg-warning-solid"],
    ["muted", "bg-muted-foreground"],
  ] as const)("paints a %s dot and names it for screen readers", (tone, className) => {
    const { container } = render(
      <ActorAvatar name="QA" initials="Q" isAgent status={{ tone, label: `trạng thái ${tone}` }} />,
    );
    const dot = container.querySelector("[data-slot='avatar-status']");
    expect(dot).toHaveClass(className);
    expect(dot).toHaveAttribute("title", `trạng thái ${tone}`);
    expect(screen.getByText(`trạng thái ${tone}`)).toHaveClass("sr-only");
  });
});
