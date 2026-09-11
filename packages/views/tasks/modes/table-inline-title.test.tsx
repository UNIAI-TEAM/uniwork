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
