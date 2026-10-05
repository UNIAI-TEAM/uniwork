import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RibbonTabRow } from "./ribbon-tab-row";
import type { RibbonTab } from "./types";

const tabs = [
  { id: "home", labelKey: "office.ribbon.label", groups: [] },
  { id: "insert", labelKey: "office.ribbon.tabs", groups: [] },
] as unknown as readonly RibbonTab[];

function renderRow() {
  render(
    <RibbonTabRow
      tabs={tabs}
      activeId="home"
      ids={{ tab: (id) => `tab-${id}`, panel: "panel" }}
      collapsed={false}
      peek={false}
      onSelect={() => undefined}
      onToggleCollapsed={() => undefined}
      onEnterBody={() => undefined}
    />,
  );
  return screen.getByRole("tablist");
}

function geometry(list: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(list, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(list, "clientWidth", { configurable: true, value: clientWidth });
}

describe("RibbonTabRow scroll chevrons", () => {
  it("renders no chevrons while the strip fits", () => {
    renderRow();
    expect(document.querySelector("[data-ribbon-tabs-prev]")).toBeNull();
    expect(document.querySelector("[data-ribbon-tabs-next]")).toBeNull();
  });

  it("shows next when overflowing, prev after scrolling, and scrolls by 160 with the right sign", () => {
    const list = renderRow();
    geometry(list, 600, 200);
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy as unknown as typeof list.scrollBy;
    fireEvent.scroll(list);

    const next = document.querySelector<HTMLButtonElement>("[data-ribbon-tabs-next]");
    expect(next).not.toBeNull();
    expect(next).toHaveAttribute("aria-label", "Các thẻ sau");
    expect(next).toHaveAttribute("tabindex", "-1");
    expect(document.querySelector("[data-ribbon-tabs-prev]")).toBeNull();
    fireEvent.click(next as HTMLButtonElement);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 160, behavior: "smooth" });

    list.scrollLeft = 100;
    fireEvent.scroll(list);
    const prev = document.querySelector<HTMLButtonElement>("[data-ribbon-tabs-prev]");
    expect(prev).not.toBeNull();
    expect(prev).toHaveAttribute("aria-label", "Các thẻ trước");
    expect(prev).toHaveAttribute("tabindex", "-1");
    fireEvent.click(prev as HTMLButtonElement);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -160, behavior: "smooth" });

    list.scrollLeft = 400;
    fireEvent.scroll(list);
    expect(document.querySelector("[data-ribbon-tabs-next]")).toBeNull();
  });

  it("centres the chevrons without a translate utility and scrolls on a real pointer press", () => {
    const list = renderRow();
    geometry(list, 600, 200);
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy as unknown as typeof list.scrollBy;
    list.scrollLeft = 100;
    fireEvent.scroll(list);

    for (const selector of ["[data-ribbon-tabs-prev]", "[data-ribbon-tabs-next]"]) {
      const chevron = document.querySelector<HTMLButtonElement>(selector) as HTMLButtonElement;
      // active:translate-y-px on the Button base would be overridden by (or override) a
      // centring translate, so the press shifts the button off the pointer.
      expect(chevron.className).not.toMatch(/(^|s)-?translate-/);
      expect(chevron.className).toContain("inset-y-0");
      expect(chevron.className).toContain("my-auto");
    }

    const next = document.querySelector<HTMLButtonElement>("[data-ribbon-tabs-next]") as HTMLButtonElement;
    fireEvent.pointerDown(next);
    fireEvent.mouseDown(next);
    fireEvent.pointerUp(next);
    fireEvent.mouseUp(next);
    fireEvent.click(next);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 160, behavior: "smooth" });
  });
});
