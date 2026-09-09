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
