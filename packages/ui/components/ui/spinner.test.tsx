import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("is decorative by default: hidden from assistive tech, no hardcoded name", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces itself as a status when given a label", () => {
    render(<Spinner label="Đang tải…" />);
    const status = screen.getByRole("status", { name: "Đang tải…" });
    expect(status).not.toHaveAttribute("aria-hidden");
  });

  it("treats an explicit aria-label like a label", () => {
    render(<Spinner aria-label="Đang lưu" />);
    expect(screen.getByRole("status", { name: "Đang lưu" })).toBeInTheDocument();
  });
});
