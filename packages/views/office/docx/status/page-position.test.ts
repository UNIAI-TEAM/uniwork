import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { docxPageFrameSelector, readDocxPagePosition } from "./page-position";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

/** A minimal DOM stand-in for the mounted surface: a scroll viewport holding a
 * `.page-wrap` whose `.page-gap` widgets mark the page turns. */
function surface(gapTops: number[], viewportTop = 0): HTMLElement {
  const scroll = document.createElement("div");
  const wrap = document.createElement("div");
  wrap.className = "page-wrap";
  for (const top of gapTops) {
    const gap = document.createElement("div");
    gap.className = "page-gap";
    gap.getBoundingClientRect = () => ({ top, bottom: top + 28, left: 0, right: 0, width: 0, height: 28, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    wrap.appendChild(gap);
  }
  scroll.appendChild(wrap);
  scroll.getBoundingClientRect = () => ({ top: viewportTop, bottom: viewportTop + 600, left: 0, right: 0, width: 0, height: 600, x: 0, y: viewportTop, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(scroll);
  return scroll;
}

describe("readDocxPagePosition", () => {
  it("returns null without a mounted paginated surface", () => {
    expect(readDocxPagePosition(null)).toBeNull();
    const bare = document.createElement("div");
    expect(readDocxPagePosition(bare)).toBeNull();
  });

  it("counts the page-gap widgets as page turns", () => {
    const scroll = surface([400, 900]);
    expect(readDocxPagePosition(scroll)).toEqual({ current: 1, total: 3 });
  });

  it("advances the current page with the viewport scroll", () => {
    // Scrolling moves the content up, so the gap rects come closer to the
    // viewport top: a boundary already above it has been passed.
    const second = surface([-100, 400]);
    expect(readDocxPagePosition(second)).toEqual({ current: 2, total: 3 });
    const third = surface([-600, -100]);
    expect(readDocxPagePosition(third)).toEqual({ current: 3, total: 3 });
  });

  it("ignores the carry spacer and counts the table cut marker", () => {
    const scroll = document.createElement("div");
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    for (const [className, top] of [["page-gap page-gap-carry", 100], ["page-gap-cut", 400], ["page-gap-cut", 900]] as const) {
      const gap = document.createElement("div");
      gap.className = className;
      gap.getBoundingClientRect = () => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      wrap.appendChild(gap);
    }
    scroll.appendChild(wrap);
    document.body.appendChild(scroll);
    expect(readDocxPagePosition(scroll)).toEqual({ current: 1, total: 3 });
  });

  it("pins the selector the renderer paints", () => {
    expect(docxPageFrameSelector()).toBe(".page-gap:not(.page-gap-carry), .page-gap-cut");
  });
});
