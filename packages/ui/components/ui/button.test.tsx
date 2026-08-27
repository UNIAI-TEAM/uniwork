import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

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
