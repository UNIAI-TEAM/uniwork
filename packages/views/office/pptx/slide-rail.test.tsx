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
});

