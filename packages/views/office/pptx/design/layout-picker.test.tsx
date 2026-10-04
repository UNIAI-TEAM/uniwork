import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { installDesignPanelI18n } from "./install-design-i18n";
import type { PptxDesignLayout } from "./design-model";
import { PptxLayoutPicker } from "./layout-picker";

initI18n();
installDesignPanelI18n();
beforeEach(async () => { await setLocale("en"); });

const LAYOUTS: PptxDesignLayout[] = [
  { name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" },
  { name: "Title and Content", path: "ppt/slideLayouts/slideLayout2.xml" },
  { name: "Blank", path: "ppt/slideLayouts/slideLayout3.xml" },
];

describe("PptxLayoutPicker", () => {
  it("renders one radio per layout from the host catalog", () => {
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={0} onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radiogroup", { name: "Slide layouts" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Use layout Blank" })).toBeInTheDocument();
  });

  it("reports the layout part path", () => {
    const onApplyLayout = vi.fn();
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={2} onApplyLayout={onApplyLayout} onResetLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Use layout Blank" }));
    expect(onApplyLayout).toHaveBeenCalledWith("ppt/slideLayouts/slideLayout3.xml");
  });

  it("checks the slide's current layout", () => {
    render(
      <PptxLayoutPicker
        layouts={LAYOUTS}
        activeLayoutPath="ppt/slideLayouts/slideLayout2.xml"
        slideIndex={0}
        onApplyLayout={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Use layout Title and Content" })).toHaveAttribute("aria-checked", "true");
  });

  it("resets to the master layout", () => {
    const onResetLayout = vi.fn();
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={1} onApplyLayout={vi.fn()} onResetLayout={onResetLayout} />);
    fireEvent.click(screen.getByText("Reset to master layout"));
    expect(onResetLayout).toHaveBeenCalledTimes(1);
  });

  it("disables every option when no slide is selected", () => {
    const onApplyLayout = vi.fn();
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={null} onApplyLayout={onApplyLayout} onResetLayout={vi.fn()} />);
    const option = screen.getByRole("radio", { name: "Use layout Blank" });
    expect(option).toBeDisabled();
    fireEvent.click(option);
    expect(onApplyLayout).not.toHaveBeenCalled();
  });

  it("says so when the deck exposes no layouts", () => {
    render(<PptxLayoutPicker layouts={[]} slideIndex={0} onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    expect(screen.getByTestId("pptx-design-layout-empty")).toHaveTextContent("This presentation exposes no layouts");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("disables the options and the reset while busy", () => {
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={0} busy onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Use layout Blank" })).toBeDisabled();
    expect(screen.getByText("Reset to master layout")).toBeDisabled();
  });

  it("moves the tabbable stop to the active layout when the catalog arrives after mount", () => {
    const view = render(<PptxLayoutPicker layouts={[]} slideIndex={0} onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    view.rerender(
      <PptxLayoutPicker
        layouts={LAYOUTS}
        activeLayoutPath="ppt/slideLayouts/slideLayout3.xml"
        slideIndex={0}
        onApplyLayout={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );
    const active = screen.getByRole("radio", { name: "Use layout Blank" });
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(active).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("radio").filter((option) => option.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("keeps one tabbable option when the catalog shrinks", () => {
    const view = render(
      <PptxLayoutPicker
        layouts={LAYOUTS}
        activeLayoutPath="ppt/slideLayouts/slideLayout3.xml"
        slideIndex={0}
        onApplyLayout={vi.fn()}
        onResetLayout={vi.fn()}
      />,
    );
    view.rerender(<PptxLayoutPicker layouts={LAYOUTS.slice(0, 1)} slideIndex={0} onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(1);
    expect(options.filter((option) => option.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("moves the roving focus with the arrow keys and wraps", () => {
    render(<PptxLayoutPicker layouts={LAYOUTS} slideIndex={0} onApplyLayout={vi.fn()} onResetLayout={vi.fn()} />);
    const options = screen.getAllByRole("radio");
    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowRight" });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(options[2] as HTMLElement, { key: "ArrowRight" });
    expect(options[0]).toHaveFocus();
  });
});