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

  it("keeps one phone-width row: only the slide position, zoom and help stay, never truncated fragments (F-09)", () => {
    render(
      <PptxStatusBar
        slideCurrent={1}
        slideTotal={5}
        counts={{ words: 3, characters: 9 }}
        language="vi"
        selectionCount={0}
        zoom={1}
        onZoomChange={vi.fn()}
        help={<PptxStatusHelpButton onOpen={vi.fn()} />}
      />,
    );
    const hiddenBelow480 = (testId: string) => screen.getByTestId(testId).className.includes("max-[480px]:hidden");
    // The slide readout never shrinks to "S..." and is never hidden.
    const slide = screen.getByTestId("pptx-status-slide");
    expect(slide.className).toContain("shrink-0");
    expect(slide.className).not.toContain("truncate");
    expect(hiddenBelow480("pptx-status-slide")).toBe(false);
    for (const id of ["pptx-status-words", "pptx-status-characters", "pptx-status-language", "pptx-status-selection"]) {
      expect(hiddenBelow480(id)).toBe(true);
    }
    // Zoom and the help "?" have no narrow-hidden ancestor.
    expect(screen.getByRole("button", { name: /100%/ }).closest("[class*='max-[480px]:hidden']")).toBeNull();
    expect(screen.getByRole("button", { name: "Show this help" }).closest("[class*='max-[480px]:hidden']")).toBeNull();
  });

  it("keeps a real selection count visible on a phone (F-09)", () => {
    render(<PptxStatusBar slideCurrent={1} slideTotal={1} selectionCount={2} zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-status-selection").className).not.toContain("max-[480px]:hidden");
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

  it("leaves out the readouts the wiring cannot source instead of showing placeholders (T12)", () => {
    render(<PptxStatusBar slideCurrent={null} slideTotal={null} zoom={1} onZoomChange={vi.fn()} />);
    for (const id of ["pptx-status-slide", "pptx-status-words", "pptx-status-characters", "pptx-status-language"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    // A partial position still keeps the unknown mark for its missing side.
    render(<PptxStatusBar slideCurrent={2} slideTotal={null} zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-status-slide")).toHaveTextContent("Slide 2 / —");
  });

  it("keeps a known zero count: an empty deck says 0 words, not nothing", () => {
    render(<PptxStatusBar slideCurrent={1} slideTotal={1} counts={{ words: 0, characters: 0 }} zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-status-words")).toHaveTextContent("Words: 0");
  });

  it("carries the notes toggle and the Normal / Slide sorter / Slide show buttons (T12)", () => {
    const onToggleNotes = vi.fn();
    const onViewChange = vi.fn();
    const onSlideShow = vi.fn();
    render(
      <PptxStatusBar
        slideCurrent={1} slideTotal={4} zoom={1} onZoomChange={vi.fn()}
        notesOpen onToggleNotes={onToggleNotes}
        view="sorter" onViewChange={onViewChange} onSlideShow={onSlideShow}
      />,
    );
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Slide sorter" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    fireEvent.click(screen.getByRole("button", { name: "Slide show" }));
    expect(onToggleNotes).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("normal");
    expect(onSlideShow).toHaveBeenCalledTimes(1);
  });

  it("speaks Vietnamese for the new controls", async () => {
    await setLocale("vi");
    render(<PptxStatusBar slideCurrent={1} slideTotal={2} zoom={1} onZoomChange={vi.fn()} onToggleNotes={vi.fn()} onSlideShow={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ghi chú" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trình chiếu" })).toBeInTheDocument();
  });

  it("announces a pending gesture without a live region for the counts", () => {
    render(<PptxStatusBar slideCurrent={1} slideTotal={1} gesturePending zoom={1} onZoomChange={vi.fn()} />);
    expect(screen.getByTestId("pptx-gesture-pending")).toHaveTextContent("Applying slide change");
    expect(screen.getByRole("group", { name: "Presentation status" }).closest("[data-pptx-status-bar]")).toHaveAttribute("aria-live", "off");
  });

  it("leaves no unlabeled tab stop in the row, help last (T12)", () => {
    const { container } = render(
      <PptxStatusBar
        slideCurrent={1} slideTotal={2} counts={{ words: 3, characters: 9 }} selectionCount={1}
        onToggleNotes={vi.fn()} onViewChange={vi.fn()} onSlideShow={vi.fn()}
        zoom={1} onZoomChange={vi.fn()} help={<PptxStatusHelpButton onOpen={vi.fn()} />}
      />,
    );
    const stops = Array.from(container.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    expect(stops.length).toBeGreaterThan(5);
    for (const stop of stops) expect(stop, stop.outerHTML).toHaveAccessibleName();
    expect(stops.at(-1)).toHaveAttribute("data-pptx-status-help");
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
