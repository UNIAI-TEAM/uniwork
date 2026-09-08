import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { InlineTitle } from "./table-inline-title";

initI18n();

describe("InlineTitle hierarchy", () => {
  it("disables the children chevron with a stable reason when hierarchy is unavailable", () => {
    const onToggle = vi.fn();
    render(
      <InlineTitle
        title="Parent"
        hasChildren
        hierarchyDisabled
        hierarchyDisabledReason="Chưa khả dụng"
        onToggleChildren={onToggle}
      />,
    );

    const chevron = screen.getByRole("button", {
      name: "Chưa khả dụng",
    });
    expect(chevron).toBeDisabled();
    expect(chevron).toHaveAttribute("title", "Chưa khả dụng");

    fireEvent.click(chevron);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
