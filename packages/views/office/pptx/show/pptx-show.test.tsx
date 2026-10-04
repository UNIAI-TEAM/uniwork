import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { buildSlideSvg } from "../canvas/build-slide-svg";
import { run, shapeNode, slide, textLayout } from "../canvas/pptx-render-fixtures";
import { PptxPresenterView } from "./pptx-presenter-view";
import { PptxSlideShow } from "./pptx-slide-show";
import { PPTX_SHOW_I18N } from "./show-i18n";
import { applyShowNavAction, formatElapsedClock, resolveShowNavAction } from "./show-nav";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const PALETTE = { pageFill: "#ffffff", chipFill: "#f4f4f5", chipStroke: "#e4e4e7", chipText: "#646464" };

/** The same rendition the canvas mounts: a real buildSlideSvg tree, no placeholder. */
function content(text: string) {
  const doc = buildSlideSvg(
    slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text })], top: 0, height: 24 }] }) })]),
    { idPrefix: "show-" + text.replace(/\s+/g, "-"), palette: PALETTE },
  );
  return { root: doc.root, widthPx: doc.widthPx, heightPx: doc.heightPx };
}

describe("show navigation math", () => {
  it("maps PowerPoint's presentation keys onto actions", () => {
    expect(resolveShowNavAction("ArrowRight")).toBe("next");
    expect(resolveShowNavAction(" ")).toBe("next");
    expect(resolveShowNavAction("PageDown")).toBe("next");
    expect(resolveShowNavAction("ArrowLeft")).toBe("previous");
    expect(resolveShowNavAction("PageUp")).toBe("previous");
    expect(resolveShowNavAction("Home")).toBe("first");
    expect(resolveShowNavAction("End")).toBe("last");
    expect(resolveShowNavAction("Escape")).toBe("exit");
    expect(resolveShowNavAction("q")).toBeNull();
  });

  it("clamps at both ends and never leaves the deck", () => {
    expect(applyShowNavAction("next", 2, 3)).toBe(2);
    expect(applyShowNavAction("previous", 0, 3)).toBe(0);
    expect(applyShowNavAction("last", 0, 3)).toBe(2);
    expect(applyShowNavAction("first", 2, 3)).toBe(0);
    expect(applyShowNavAction("next", 0, 0)).toBe(0);
  });

  it("formats the elapsed clock as MM:SS and H:MM:SS", () => {
    expect(formatElapsedClock(0)).toBe("00:00");
    expect(formatElapsedClock(65_000)).toBe("01:05");
    expect(formatElapsedClock(3_665_000)).toBe("1:01:05");
    expect(formatElapsedClock(-1)).toBe("00:00");
  });
});

describe("PptxSlideShow", () => {
  it("renders the current slide rendition and the counter", () => {
    render(<PptxSlideShow slideCount={3} index={1} onIndexChange={vi.fn()} onExit={vi.fn()} content={content("Second slide")} />);
    expect(screen.getByTestId("pptx-show-counter")).toHaveTextContent("Slide 2 of 3");
    expect(screen.getByText("Second slide")).toBeInTheDocument();
    expect(document.querySelector("[data-pptx-show-svg]")).not.toBeNull();
  });

  it("advances with ArrowRight and goes back with ArrowLeft", () => {
    const onIndexChange = vi.fn();
    render(<PptxSlideShow slideCount={3} index={1} onIndexChange={onIndexChange} onExit={vi.fn()} content={content("Slide")} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("jumps to the ends with Home and End", () => {
    const onIndexChange = vi.fn();
    render(<PptxSlideShow slideCount={5} index={2} onIndexChange={onIndexChange} onExit={vi.fn()} content={content("Slide")} />);
    fireEvent.keyDown(window, { key: "End" });
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(window, { key: "Home" });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("stays on the last slide instead of wrapping", () => {
    const onIndexChange = vi.fn();
    render(<PptxSlideShow slideCount={3} index={2} onIndexChange={onIndexChange} onExit={vi.fn()} content={content("Slide")} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("exits on Escape and on the exit control", () => {
    const onExit = vi.fn();
    render(<PptxSlideShow slideCount={3} index={0} onIndexChange={vi.fn()} onExit={onExit} content={content("Slide")} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "End show" }));
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("advances on a click on the stage", () => {
    const onIndexChange = vi.fn();
    render(<PptxSlideShow slideCount={3} index={0} onIndexChange={onIndexChange} onExit={vi.fn()} content={content("Slide")} />);
    fireEvent.click(screen.getByTestId("pptx-show-stage"));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("reports a slide that is still building instead of a blank stage", () => {
    render(<PptxSlideShow slideCount={2} index={0} onIndexChange={vi.fn()} onExit={vi.fn()} building />);
    expect(screen.getByText("Building the slide rendition…")).toBeInTheDocument();
  });
});

describe("PptxPresenterView", () => {
  it("renders the current slide, the next-slide preview, the notes and the timer", () => {
    render(
      <PptxPresenterView
        slideCount={3}
        index={0}
        onIndexChange={vi.fn()}
        onExit={vi.fn()}
        content={content("Current")}
        nextContent={content("Up next")}
        notes="Open with the customer story"
        now={() => 0}
      />,
    );
    expect(screen.getByTestId("pptx-presenter-current")).toHaveTextContent("Current");
    expect(screen.getByTestId("pptx-presenter-next")).toHaveTextContent("Up next");
    expect(screen.getByTestId("pptx-presenter-notes")).toHaveTextContent("Open with the customer story");
    expect(screen.getByTestId("pptx-presenter-timer")).toHaveTextContent("Elapsed 00:00");
  });

  it("says so when the slide has no speaker notes", () => {
    render(<PptxPresenterView slideCount={1} index={0} onIndexChange={vi.fn()} onExit={vi.fn()} content={content("Only")} notes={null} now={() => 0} />);
    expect(screen.getByTestId("pptx-presenter-notes")).toHaveTextContent("No speaker notes for this slide.");
  });

  it("ticks the elapsed timer", () => {
    vi.useFakeTimers();
    let clock = 0;
    try {
      render(<PptxPresenterView slideCount={2} index={0} onIndexChange={vi.fn()} onExit={vi.fn()} content={content("Slide")} now={() => clock} />);
      clock = 65_000;
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByTestId("pptx-presenter-timer")).toHaveTextContent("Elapsed 01:05");
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves to the next slide and exits from the presenter controls", () => {
    const onIndexChange = vi.fn();
    const onExit = vi.fn();
    render(<PptxPresenterView slideCount={2} index={0} onIndexChange={onIndexChange} onExit={onExit} content={content("Slide")} now={() => 0} />);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "End show" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("show i18n bundle", () => {
  it("carries a vi + en string for every office.pptx.show.* key", () => {
    for (const [key, entry] of Object.entries(PPTX_SHOW_I18N)) {
      expect(key.startsWith("office.pptx.show."), key).toBe(true);
      expect(entry.en.trim(), key + " en").not.toBe("");
      expect(entry.vi.trim(), key + " vi").not.toBe("");
      const vars = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
      expect(vars(entry.vi), key).toBe(vars(entry.en));
    }
  });
});
