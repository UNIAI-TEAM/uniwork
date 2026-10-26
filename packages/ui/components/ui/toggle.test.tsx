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

  it("leaves focus to the global outline instead of a faint ring", () => {
    render(<Toggle>Lọc</Toggle>);
    const toggle = screen.getByRole("button", { name: "Lọc" });
    expect(toggle.className).not.toMatch(/outline-none|focus-visible:ring/);
  });

  it("draws pressed apart from hover, in every variant", () => {
    render(
      <>
        <Toggle defaultPressed>Mặc định</Toggle>
        <Toggle variant="toolbar" defaultPressed>
          Thanh công cụ
        </Toggle>
      </>,
    );
    for (const name of ["Mặc định", "Thanh công cụ"]) {
      const toggle = screen.getByRole("button", { name });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle).toHaveClass(
        "aria-pressed:bg-brand-subtle",
        "aria-pressed:text-brand-subtle-foreground",
        "aria-pressed:font-semibold",
      );
      expect(toggle.className).not.toContain("aria-pressed:bg-muted");
    }
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
