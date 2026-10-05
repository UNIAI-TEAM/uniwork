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
});
