import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Logo, type LogoTone, type LogoVariant } from "./logo";
import { COMPACT_MAX_SIZE, MARK, MARK_COMPACT } from "./mark.generated";

afterEach(cleanup);

const VARIANTS: LogoVariant[] = ["mark", "wordmark", "lockup", "lockup-stacked"];
const TONES: LogoTone[] = ["gradient", "flat", "mono"];

function svgOf(container: HTMLElement) {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("Logo rendered no <svg>");
  return svg;
}

describe("Logo", () => {
  it("renders every variant in every tone", () => {
    for (const variant of VARIANTS) {
      for (const tone of TONES) {
        const { container } = render(<Logo variant={variant} tone={tone} />);
        expect(svgOf(container).querySelectorAll("path").length).toBeGreaterThan(0);
        cleanup();
      }
    }
  });

  it("mono inherits currentColor so it works inside buttons and dark rails", () => {
    const { container } = render(<Logo tone="mono" />);
    const fills = [...svgOf(container).querySelectorAll("[fill]")].map((n) =>
      n.getAttribute("fill"),
    );
    expect(fills).toContain("currentColor");
    expect(fills.some((f) => f?.startsWith("url("))).toBe(false);
  });

  it("flat uses the brand token, never a hardcoded hex", () => {
    const { container } = render(<Logo tone="flat" />);
    const fills = [...svgOf(container).querySelectorAll("g[fill]")].map((n) =>
      n.getAttribute("fill"),
    );
    expect(fills).toContain("var(--brand)");
  });

  it("gradient carries all three brand stops", () => {
    const { container } = render(<Logo tone="gradient" />);
    // Read children rather than a descendant selector: jsdom does not match
    // `linearGradient stop` across the SVG namespace boundary.
    const gradient = svgOf(container).querySelector("linearGradient");
    expect(gradient?.children).toHaveLength(3);
    expect([...(gradient?.children ?? [])].map((n) => n.getAttribute("class"))).toEqual([
      "[stop-color:#0044E3] dark:[stop-color:#4D8DFF]",
      "[stop-color:#00B4FC] dark:[stop-color:#35CBFF]",
      "[stop-color:#02DEF5] dark:[stop-color:#5AF0FF]",
    ]);
  });

  it("carries an on-dark ramp for every coloured part of the mark", () => {
    // The light ramp's deep end measures 2.19:1 on the dark sidebar, which
    // erases the left-hand figure. Every stop and the depth crescent need a
    // `dark:` counterpart, and it has to be a literal class string: Tailwind
    // extracts candidates from source text, so a composed one emits no CSS.
    const { container } = render(<Logo size={48} tone="gradient" />);
    const classed = [...svgOf(container).querySelectorAll("[class]")].map(
      (n) => n.getAttribute("class") ?? "",
    );
    const themed = classed.filter((c) => c.includes("stop-color:") || c.includes("fill:#"));
    expect(themed).toHaveLength(4); // three stops plus the crescent
    for (const c of themed) expect(c).toMatch(/dark:\[(stop-color|fill):#[0-9A-F]{6}\]/);
  });

  it("gives each instance its own gradient id", () => {
    // Two logos on one page sharing a <defs> id is the classic inline-SVG bug:
    // whichever mounts second wins, and the first turns into a flat fill.
    const { container } = render(
      <>
        <Logo />
        <Logo />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("swaps in the compact artwork at or below the compact size", () => {
    const bodyY = (el: HTMLElement) =>
      svgOf(el).querySelector("g > rect")?.getAttribute("y");

    const small = render(<Logo size={COMPACT_MAX_SIZE} />);
    expect(bodyY(small.container)).toBe(String(MARK_COMPACT.bodies[0]!.y));
    cleanup();

    const large = render(<Logo size={COMPACT_MAX_SIZE + 1} />);
    expect(bodyY(large.container)).toBe(String(MARK.bodies[0]!.y));
  });

  it("drops the depth crescent in the compact artwork", () => {
    const { container } = render(<Logo size={16} />);
    expect(svgOf(container).querySelector("clipPath")).toBeNull();
  });

  it("keeps the aspect ratio of the artwork", () => {
    const { container } = render(<Logo size={92} />);
    const svg = svgOf(container);
    expect(svg.getAttribute("height")).toBe("92");
    expect(Number(svg.getAttribute("width"))).toBeCloseTo(MARK.width, 5);
  });

  it("names itself for screen readers by default", () => {
    const { container } = render(<Logo />);
    const svg = svgOf(container);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("UniWork");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps the lockup's wordmark on the text colour, never the mark's gradient", () => {
    // The mark's gradient is declared in user space across the mark's own 128
    // units. The wordmark sits past that, so filling it with the same gradient
    // clamps it to the last stop and the word comes out aqua.
    const { container } = render(<Logo variant="lockup" tone="gradient" />);
    const paths = [...svgOf(container).querySelectorAll("path")];
    const wordmark = paths.at(-1);
    expect(wordmark?.getAttribute("fill")).toBe("currentColor");
  });

  it("gives the standalone wordmark the text colour in every tone", () => {
    for (const tone of TONES) {
      const { container } = render(<Logo variant="wordmark" tone={tone} />);
      expect(svgOf(container).querySelector("path")?.getAttribute("fill")).toBe(
        "currentColor",
      );
      expect(svgOf(container).querySelector("linearGradient")).toBeNull();
      cleanup();
    }
  });

  it("goes silent when decorative", () => {
    const { container } = render(<Logo decorative />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });
});
