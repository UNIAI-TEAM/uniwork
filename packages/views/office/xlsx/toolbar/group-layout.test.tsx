import { render, screen } from "@testing-library/react";
import { Table2 } from "lucide-react";
import { describe, expect, it } from "vitest";
import { XlsxLargeButton, XlsxLargeLabel } from "./group-layout";

describe("XlsxLargeButton", () => {
  it("clamps the caption to two lines with room under it and a 28px icon, so it never touches the group label", () => {
    render(
      <XlsxLargeButton aria-label="Conditional Formatting">
        <Table2 aria-hidden />
        <XlsxLargeLabel>Conditional Formatting</XlsxLargeLabel>
      </XlsxLargeButton>,
    );
    const button = screen.getByRole("button", { name: "Conditional Formatting" });
    expect(button.className).toContain("py-0.5");
    expect(button.className).toContain("size-7");
    const label = screen.getByText("Conditional Formatting");
    expect(label.className).toContain("line-clamp-2");
    expect(label.className).toContain("pb-px");
  });
});
