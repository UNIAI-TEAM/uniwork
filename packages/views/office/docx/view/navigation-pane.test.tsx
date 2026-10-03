// UNI-924 A6: the navigation pane flattens the nested outline, reports clicks
// and shows the empty state; the scroll helper jumps to the heading DOM.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxOutlineItem } from "./headings-outline";
import { DocxNavigationPane, scrollDocxHeadingIntoView } from "./navigation-pane";

const ITEMS: DocxOutlineItem[] = [
  {
    id: "heading-0",
    level: 1,
    text: "One",
    pos: 0,
    children: [{ id: "heading-10", level: 2, text: "One A", pos: 10, children: [] }],
  },
  { id: "heading-20", level: 1, text: "Two", pos: 20, children: [] },
];

describe("DocxNavigationPane", () => {
  it("renders the nested outline flattened in document order with depth indent", () => {
    render(<DocxNavigationPane items={ITEMS} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["One", "One A", "Two"]);
    expect(
      Number.parseFloat(screen.getByTestId("docx-navigation-item-heading-0").style.paddingInlineStart),
    ).toBeCloseTo(8, 5);
    expect(
      Number.parseFloat(screen.getByTestId("docx-navigation-item-heading-10").style.paddingInlineStart),
    ).toBeCloseTo(20, 5);
  });

  it("reports the clicked item and highlights the active heading", () => {
    const onSelect = vi.fn();
    render(<DocxNavigationPane items={ITEMS} activeId="heading-10" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "One A" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]?.children[0]);
    expect(screen.getByTestId("docx-navigation-item-heading-10")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("docx-navigation-item-heading-0")).not.toHaveAttribute("aria-current");
  });

  it("shows the empty state and the close affordance when one is provided", () => {
    const onClose = vi.fn();
    render(<DocxNavigationPane items={[]} onClose={onClose} />);
    expect(screen.getByTestId("docx-navigation-empty")).toHaveTextContent("Tài liệu chưa có tiêu đề");
    expect(screen.queryByRole("button", { name: "One" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Đóng ngăn điều hướng" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("scrollDocxHeadingIntoView", () => {
  it("scrolls the heading element returned by the editor view", () => {
    const heading = document.createElement("h1");
    const scrollIntoView = vi.spyOn(heading, "scrollIntoView").mockImplementation(() => {});
    const view = { nodeDOM: (pos: number) => (pos === 10 ? heading : null) };

    expect(scrollDocxHeadingIntoView(view, 10)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scrollDocxHeadingIntoView(view, 11)).toBe(false);
    expect(scrollDocxHeadingIntoView(null, 10)).toBe(false);
    expect(scrollDocxHeadingIntoView(undefined, 10)).toBe(false);
  });
});
