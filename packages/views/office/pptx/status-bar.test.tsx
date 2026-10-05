import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxStatusBar, PptxStatusHelpButton, pptxLanguageLabel } from "./status-bar";

initI18n();
beforeEach(async () => { await setLocale("en"); });

describe("pptxLanguageLabel", () => {
  it("returns the primary subtag of a BCP-47 tag", () => {
    expect(pptxLanguageLabel("vi-VN")).toBe("vi");
    expect(pptxLanguageLabel("EN_us")).toBe("en");
    expect(pptxLanguageLabel("")).toBeNull();
    expect(pptxLanguageLabel(null)).toBeNull();
    expect(pptxLanguageLabel(undefined)).toBeNull();
  });
});

describe("PptxStatusBar", () => {
  it("renders slide x/y, counts and language on the left and selection + zoom on the right (C10)", () => {
    render(
      <PptxStatusBar
        slideCurrent={2}
        slideTotal={3}
        counts={{ words: 245, characters: 1200 }}
        language="vi-VN"
        selectionCount={0}
        zoom={1}
        onZoomChange={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: "Presentation status" });
    expect(group).toHaveAttribute("data-office-status-bar");
    expect(group.closest("[data-pptx-status-bar]")).not.toBeNull();
    expect(screen.getByTestId("pptx-status-slide")).toHaveTextContent("Slide 2 / 3");
    expect(screen.getByTestId("pptx-status-words")).toHaveTextContent("Words: 245");
    expect(screen.getByTestId("pptx-status-characters")).toHaveTextContent("Characters: 1200");
    expect(screen.getByTestId("pptx-status-language")).toHaveTextContent("Language: vi");
    expect(screen.getByTestId("pptx-status-selection")).toHaveTextContent("No selection");
    expect(screen.getByRole("button", { name: /100%/ })).toBeInTheDocument();
  });

  it("shows a real selection count and the compact zoom control", () => {
    const onZoomChange = vi.fn();
    render(<PptxStatusBar slideCurrent={1} slideTotal={1} selectionCount={3} zoom={1} onZoomChange={onZoomChange} />);
    expect(screen.getByTestId("pptx-status-selection")).toHaveTextContent("Selected: 3");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomChange).toHaveBeenCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomChange).toHaveBeenLastCalledWith(0.75);
    // The status bar uses the compact form: no fit control.
    expect(screen.queryByRole("button", { name: "Fit to width" })).not.toBeInTheDocument();
  });

  it("renders the unknown mark for fields the wiring cannot source yet", () => {
    render(<PptxStatusBar slideCurrent={null} slideTotal={null} zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-status-slide")).toHaveTextContent("—");
    expect(screen.getByTestId("pptx-status-words")).toHaveTextContent("Words: —");
    expect(screen.getByTestId("pptx-status-language")).toHaveTextContent("Language: —");
  });

  it("announces a pending gesture without a live region for the counts", () => {
    render(<PptxStatusBar slideCurrent={1} slideTotal={1} gesturePending zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-gesture-pending")).toHaveTextContent("Applying slide change");
    expect(screen.getByRole("group", { name: "Presentation status" }).closest("[data-pptx-status-bar]")).toHaveAttribute("aria-live", "off");
  });

  it("renders the help slot last and the help button opens shortcuts", () => {
    const onOpen = vi.fn();
    render(
      <PptxStatusBar slideCurrent={1} slideTotal={1} zoom={1} onZoomChange={vi.fn()} help={<PptxStatusHelpButton onOpen={onOpen} />} />,
    );
    const help = screen.getByRole("button", { name: "Show this help" });
    expect(help).toHaveAttribute("data-pptx-status-help");
    expect(help).toHaveAttribute("title", "Show this help");
    expect(help.closest("[data-pptx-status-bar]")).not.toBeNull();
    fireEvent.click(help);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
