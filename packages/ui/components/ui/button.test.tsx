import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "./button";

describe("Button", () => {
  it("renders children and respects variant class", () => {
    render(<Button variant="destructive">Xóa</Button>);
    const btn = screen.getByRole("button", { name: "Xóa" });
    expect(btn.className).toContain("text-destructive");
  });

  it("supports outline variant and lg/icon-sm sizes", () => {
    const { rerender } = render(
      <Button variant="outline" size="lg">
        Ok
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Ok" })).toHaveClass(
      "border-input",
      "h-9",
    );
    rerender(
      <Button size="icon-sm" aria-label="x">
        x
      </Button>,
    );
    expect(screen.getByRole("button", { name: "x" })).toHaveClass("size-7");
  });

  it("keeps compact toolbar actions quieter than form controls", () => {
    render(<Button variant="toolbar">Hiển thị</Button>);
    expect(screen.getByRole("button", { name: "Hiển thị" })).toHaveClass(
      "border-transparent",
      "bg-surface-hover/60",
      "aria-expanded:bg-surface-hover",
    );
    expect(screen.getByRole("button", { name: "Hiển thị" })).not.toHaveClass(
      "border-input",
    );
  });
});

describe("Button solid and meeting variants", () => {
  it("fills a destructive action with the solid signal and on-solid text", () => {
    render(<Button variant="destructiveSolid">Kết thúc</Button>);
    const btn = screen.getByRole("button", { name: "Kết thúc" });
    expect(btn).toHaveClass("bg-destructive-solid", "text-on-solid", "border-destructive-solid");
    expect(btn.className).not.toMatch(/!/);
  });

  it("fills a success action with the solid signal and on-solid text", () => {
    render(<Button variant="successSolid">Duyệt</Button>);
    const btn = screen.getByRole("button", { name: "Duyệt" });
    expect(btn).toHaveClass("bg-success-solid", "text-on-solid");
    expect(btn.className).not.toMatch(/!/);
  });

  it("paints a chip for the dark meeting bar from its own tokens", () => {
    render(<Button variant="meetingChip">Thiết bị</Button>);
    const btn = screen.getByRole("button", { name: "Thiết bị" });
    expect(btn).toHaveClass(
      "bg-meeting-bar-chip-bg",
      "text-meeting-bar-foreground",
      "border-meeting-bar-border",
      "hover:bg-meeting-bar-chip-hover",
    );
    expect(btn).not.toHaveClass("border-input");
    expect(btn.className).not.toMatch(/!/);
  });
});

describe("ButtonLink", () => {
  it("stays a link: button styling without button semantics", () => {
    render(
      <ButtonLink variant="outline" size="sm" href="/export" download>
        Tải về
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Tải về" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveClass("border-input", "h-7");
    // Base UI's non-native button path stamps `role="button"` over the anchor
    // and its native path stamps `type="button"`; a link that navigates or
    // downloads is neither.
    expect(link).not.toHaveAttribute("role");
    expect(link).not.toHaveAttribute("type");
  });

  it("renders without the Base UI native-button assertion", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ButtonLink href="/export">Tải về</ButtonLink>);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
