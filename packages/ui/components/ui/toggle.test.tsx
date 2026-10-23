import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toggle } from "./toggle";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

describe("Toggle", () => {
  it("keeps toolbar toggles quieter than standalone outline controls", () => {
    render(<Toggle variant="toolbar">Danh sách</Toggle>);

    expect(screen.getByRole("button", { name: "Danh sách" })).toHaveClass(
      "border-transparent",
      "bg-surface-hover/60",
    );
    expect(screen.getByRole("button", { name: "Danh sách" })).not.toHaveClass(
      "border-input",
    );
  });

  it("propagates the toolbar variant through a toggle group", () => {
    render(
      <ToggleGroup variant="toolbar">
        <ToggleGroupItem value="all">Tất cả</ToggleGroupItem>
        <ToggleGroupItem value="unread">Chưa đọc</ToggleGroupItem>
      </ToggleGroup>,
    );

    expect(screen.getByRole("button", { name: "Tất cả" })).toHaveClass(
      "border-transparent",
      "bg-surface-hover/60",
    );
    expect(screen.getByRole("button", { name: "Chưa đọc" })).not.toHaveClass(
      "border-input",
    );
  });
});
