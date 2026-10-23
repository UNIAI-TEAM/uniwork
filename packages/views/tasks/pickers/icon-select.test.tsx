import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconSelect } from "./icon-select";

describe("IconSelect", () => {
  it("renders each option with its icon and label", () => {
    render(
      <IconSelect
        id="priority"
        label="Độ ưu tiên"
        value="none"
        onValueChange={vi.fn()}
        triggerIcon={<span data-testid="trigger-icon">T</span>}
        items={[
          {
            value: "none",
            label: "Không ưu tiên",
            icon: <span data-testid="opt-none">n</span>,
          },
          {
            value: "high",
            label: "Cao",
            icon: <span data-testid="opt-high">h</span>,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Độ ưu tiên" }));
    const list = screen.getByRole("listbox");
    expect(within(list).getByTestId("opt-none")).toBeInTheDocument();
    expect(within(list).getByTestId("opt-high")).toBeInTheDocument();
    expect(within(list).getByText("Cao")).toBeInTheDocument();
  });
});
