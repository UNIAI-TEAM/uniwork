import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

const tokens = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");

function block(selector: string): string {
  const start = tokens.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  return tokens.slice(start, tokens.indexOf("\n}", start));
}

/** A slot's #rrggbb value in one theme block. */
function slot(scope: string, name: string): string {
  const match = block(scope).match(new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6});`, "m"));
  if (!match?.[1]) throw new Error(`--${name} is not a hex colour in ${scope}`);
  return match[1];
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}

/** sRGB alpha compositing — what the browser paints for `bg-x/NN` over a base. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `bg-destructive-soft/40` → { name: "destructive-soft", alpha: 0.4 }. Only a
 * class that names a colour slot counts, so `text-body` or `bg-clip-padding`
 * from the base recipe are skipped.
 */
function utility(classes: string[], prefix: string): { name: string; alpha: number } {
  for (const c of classes) {
    if (!c.startsWith(prefix)) continue;
    const [name, pct] = c.slice(prefix.length).split("/");
    if (!new RegExp(`^\\s*--${name}:\\s*#`, "m").test(block(":root"))) continue;
    return { name: name!, alpha: pct ? Number(pct) / 100 : 1 };
  }
  throw new Error(`no ${prefix}<colour> class on the destructive button`);
}

/**
 * The destructive button is the soft red that confirms an irreversible step
 * (leave, delete, close). It lands on four planes: the page, a card / dialog
 * body (surface-raised), the dialog footer (`bg-surface-hover/70` over
 * surface-raised, see dialog.tsx) and the muted band. The old dark recipe —
 * an alpha of the text red (`dark:bg-destructive/20`, hover `/30`) — measured
 * 4.18 / 3.47 on the dialog footer and 4.69 / 3.86 on a card, because the
 * fill brightened toward the text it carried. The test reads the classes the
 * button actually ships and composites them over each plane, so swapping the
 * fill back to an alpha of the text colour fails here.
 */
describe("destructive button contrast", () => {
  render(<Button variant="destructive">Rời tổ chức</Button>);
  const classes = screen.getByRole("button").className.split(/\s+/);

  it("reads the soft signal pair and carries no per-theme overrides", () => {
    expect(classes).toContain("bg-destructive-soft");
    expect(classes).toContain("text-destructive-soft-foreground");
    expect(classes).toContain("hover:bg-destructive-soft-hover");
    // The base recipe's `dark:aria-invalid:*` edge is shared by every variant;
    // what must not come back is a dark-only fill or ink.
    expect(classes.filter((c) => /^dark:(?:[a-z-]+:)*(?:bg|text)-/.test(c))).toEqual([]);
  });

  const rest = utility(classes, "bg-");
  const hover = utility(classes, "hover:bg-");
  const text = utility(classes, "text-");

  for (const scope of [":root", ".dark"]) {
    const raised = rgb(slot(scope, "surface-raised"));
    const planes: Record<string, Rgb> = {
      background: rgb(slot(scope, "background")),
      "card / surface-raised": raised,
      "dialog footer": over(rgb(slot(scope, "surface-hover")), 0.7, raised),
      muted: rgb(slot(scope, "muted")),
    };
    for (const [plane, base] of Object.entries(planes)) {
      for (const [state, fill] of [["rest", rest], ["hover", hover]] as const) {
        it(`clears 4.5:1 in ${scope} on ${plane} at ${state}`, () => {
          const painted = over(rgb(slot(scope, fill.name)), fill.alpha, base);
          const ink = over(rgb(slot(scope, text.name)), text.alpha, painted);
          expect(contrast(ink, painted)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
