import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { XlsxFormulaRow } from "./formula-row";

describe("XlsxFormulaRow layout", () => {
  it("orders name box, fx and the formula input, with no visible label", () => {
    const { container } = render(<XlsxFormulaRow address="B2" value="=A1" disabled={false} onChange={() => {}} onCommit={() => {}} />);
    const row = screen.getByTestId("xlsx-formula-row");
    const nameBox = screen.getByTestId("xlsx-name-box");
    const input = screen.getByTestId("xlsx-formula-bar");
    const fx = screen.getByText("fx");
    const order = Array.from(row.querySelectorAll("*"));
    expect(order.indexOf(nameBox)).toBeLessThan(order.indexOf(fx));
    expect(order.indexOf(fx)).toBeLessThan(order.indexOf(input));
    // Accessible name stays, but there is no <label> element and no visible text node for it.
    expect(screen.getByRole("combobox", { name: /formula or value|công thức hoặc giá trị/i })).toBe(input);
    expect(container.querySelector("label")).toBeNull();
    expect(screen.queryByText(/formula or value|công thức hoặc giá trị/i)).toBeNull();
  });

  it("does not pad the input inside the fixed-height row", () => {
    render(<XlsxFormulaRow address="A1" value="" disabled={false} onChange={() => {}} onCommit={() => {}} />);
    const input = screen.getByTestId("xlsx-formula-bar");
    expect(input.className).not.toMatch(/\bpy-\d/);
    expect(input.className).toMatch(/\bh-full\b/);
    expect(input.className).not.toMatch(/\bborder\b(?!-)/);
  });
});
