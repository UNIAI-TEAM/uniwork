import { render } from "@testing-library/react";
import { CalendarDays } from "lucide-react";
import { describe, expect, it } from "vitest";
import { IconTile, TINTS, tintClass, tintForegroundClass, tintSolidClass } from "./icon-tile";

describe("IconTile", () => {
  it("is decorative and carries the tint fill + foreground pair", () => {
    const { container } = render(<IconTile icon={CalendarDays} tone="violet" />);
    const tile = container.querySelector('[data-slot="icon-tile"]');
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveClass("bg-tint-violet", "text-tint-violet-foreground");
    expect(tile?.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the muted tone so an untinted call still has a fill", () => {
    const { container } = render(<IconTile icon={CalendarDays} />);
    expect(container.querySelector('[data-slot="icon-tile"]')).toHaveClass("bg-muted");
  });

  it("renders the solid variant as saturated fill under a white glyph", () => {
    const { container } = render(<IconTile icon={CalendarDays} tone="green" variant="solid" size="xs" />);
    const tile = container.querySelector('[data-slot="icon-tile"]');
    expect(tile).toHaveClass("bg-tint-green-solid", "text-on-solid", "size-5");
    expect(tile).not.toHaveClass("bg-tint-green");
  });

  it("spells out every tint class so Tailwind can generate them", () => {
    for (const tint of TINTS) {
      expect(tintClass[tint]).toBe(`bg-tint-${tint} text-tint-${tint}-foreground`);
      expect(tintForegroundClass[tint]).toBe(`text-tint-${tint}-foreground`);
      expect(tintSolidClass[tint]).toBe(`bg-tint-${tint}-solid text-on-solid`);
    }
  });
});
