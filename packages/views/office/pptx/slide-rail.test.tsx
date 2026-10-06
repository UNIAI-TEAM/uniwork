import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxSlideRail } from "./slide-rail";

initI18n();
beforeEach(async () => { await setLocale("en"); });

describe("PptxSlideRail", () => {
  it("selects a slide with an accessible current marker", () => {
    const onSelect = vi.fn();
    render(<PptxSlideRail slides={[{ id: "s1", label: "Intro" }, { id: "s2" }]} selectedIndex={0} onSelect={onSelect} />);
    const slides = screen.getAllByRole("button");
    expect(slides[0]).toHaveAttribute("aria-current", "page");
    fireEvent.click(slides[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders the generated thumbnail and falls back to the index badge", () => {
    render(
      <PptxSlideRail
        slides={[{ id: "s1", label: "Intro", thumbnailUrl: "data:image/svg+xml;charset=utf-8,%3Csvg/%3E" }, { id: "s2" }]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    const [first, second] = screen.getAllByRole("button");
    const image = first!.querySelector("img");
    expect(image).toHaveAttribute("src", "data:image/svg+xml;charset=utf-8,%3Csvg/%3E");
    expect(image).toHaveAttribute("alt", "");
    expect(second!.querySelector("img")).toBeNull();
    expect(second).toHaveTextContent("2");
  });

  it("narrows to a thumbnails-only strip on a phone so the canvas keeps the width (F-09)", () => {
    render(<PptxSlideRail slides={[{ id: "s1", label: "Intro" }, { id: "s2" }]} selectedIndex={0} onSelect={vi.fn()} />);
    const rail = screen.getByRole("navigation");
    expect(rail.className).toContain("max-[480px]:w-16");
    const [first] = screen.getAllByRole("button");
    // The caption drops out; the slide stays reachable by its accessible name.
    expect(first!.querySelector("span.truncate")!.className).toContain("max-[480px]:hidden");
    expect(first).toHaveAttribute("aria-label", expect.stringContaining("Intro"));
  });

  it("veils a hidden slide's thumbnail with the page token so it dims in light and dark", () => {
    render(<PptxSlideRail slides={[{ id: "s1", thumbnailUrl: "data:image/png;base64,AA==" }, { id: "s2", thumbnailUrl: "data:image/png;base64,AA==", hidden: true }]} selectedIndex={0} onSelect={vi.fn()} />);
    const [shown, hidden] = screen.getAllByRole("button");
    expect(shown!.querySelector("[data-slide-hidden-veil]")).toBeNull();
    const veil = hidden!.querySelector("[data-slide-hidden-veil]");
    expect(veil).not.toBeNull();
    expect(veil!.className).toMatch(/\bbg-background\//);
    expect(veil).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a 44px touch target on a coarse pointer even at phone width", () => {
    render(<PptxSlideRail slides={[{ id: "s1" }, { id: "s2" }]} selectedIndex={0} onSelect={vi.fn()} />);
    for (const slide of screen.getAllByRole("button")) {
      expect(slide.className).toContain("pointer-coarse:max-[480px]:min-h-11");
    }
  });
  it("deletes the focused slide with Delete or Backspace and keeps the key off the canvas (UNI-958)", () => {
    const onDelete = vi.fn();
    const outer = vi.fn();
    render(<PptxSlideRail slides={[{ id: "s1" }, { id: "s2" }, { id: "s3" }]} selectedIndex={1} onSelect={vi.fn()} onDelete={onDelete} />);
    document.body.addEventListener("keydown", outer);
    const slides = screen.getAllByRole("button");
    fireEvent.keyDown(slides[1]!, { key: "Delete" });
    fireEvent.keyDown(slides[2]!, { key: "Backspace" });
    expect(onDelete.mock.calls).toEqual([[1], [2]]);
    // The canvas Delete removes the selected shape; a rail Delete must never reach it.
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", outer);
  });

  it("never deletes the last slide and ignores Delete without a delete port", () => {
    const onDelete = vi.fn();
    const { rerender } = render(<PptxSlideRail slides={[{ id: "s1" }]} selectedIndex={0} onSelect={vi.fn()} onDelete={onDelete} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Delete" });
    expect(onDelete).not.toHaveBeenCalled();
    rerender(<PptxSlideRail slides={[{ id: "s1" }, { id: "s2" }]} selectedIndex={0} onSelect={vi.fn()} />);
    expect(() => fireEvent.keyDown(screen.getAllByRole("button")[0]!, { key: "Delete" })).not.toThrow();
  });
});
