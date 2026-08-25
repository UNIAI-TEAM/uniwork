import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders children and respects variant class", () => {
    render(<Button variant="danger">Xóa</Button>);
    const btn = screen.getByRole("button", { name: "Xóa" });
    expect(btn.className).toContain("bg-danger");
  });
});
