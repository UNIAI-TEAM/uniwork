import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select, SelectTrigger, SelectValue } from "./select";

describe("SelectTrigger", () => {
  it("supports a subtle treatment for compact settings surfaces", () => {
    render(
      <Select
        items={[{ value: "status", label: "Trạng thái" }]}
        value="status"
      >
        <SelectTrigger variant="subtle" aria-label="Nhóm">
          <SelectValue />
        </SelectTrigger>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Nhóm" })).toHaveClass(
      "border-transparent",
      "bg-surface-hover/60",
    );
    expect(screen.getByRole("combobox", { name: "Nhóm" })).not.toHaveClass(
      "border-input",
    );
  });
});
