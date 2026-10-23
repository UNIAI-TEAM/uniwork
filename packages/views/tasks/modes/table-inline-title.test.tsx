import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { InlineTitle } from "./table-inline-title";

initI18n();

describe("InlineTitle hierarchy", () => {
  it("hides the children chevron when sub-tasks are hidden", () => {
    const onToggle = vi.fn();
    render(
      <InlineTitle
        title="Parent"
        hasChildren
        hierarchyDisabled
        onToggleChildren={onToggle}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /công việc con/i }),
    ).not.toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("InlineTitle expand control", () => {
  it("reports its state with aria-expanded and toggles on click", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onToggle = vi.fn();
    const { rerender } = render(
      <InlineTitle title="Parent" hasChildren collapsed onToggleChildren={onToggle} />,
    );

    const expand = screen.getByRole("button", { name: "Mở công việc con" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <InlineTitle title="Parent" hasChildren collapsed={false} onToggleChildren={onToggle} />,
    );
    expect(
      screen.getByRole("button", { name: "Thu công việc con" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("is a 24px control with a 14px icon and a 44px coarse-pointer hit area", () => {
    render(<InlineTitle title="Parent" hasChildren collapsed onToggleChildren={vi.fn()} />);

    const expand = screen.getByRole("button", { name: "Mở công việc con" });
    expect(expand).toHaveClass("size-6");
    // An invisible hit area, not a bigger box: a 44px button would grow the
    // 40px row the virtualizer is sized for.
    expect(expand).toHaveClass("pointer-coarse:after:size-11");
    expect(expand.className).not.toContain("outline-none");
    expect(expand.querySelector("svg")).toHaveClass("size-3.5");
  });
});
