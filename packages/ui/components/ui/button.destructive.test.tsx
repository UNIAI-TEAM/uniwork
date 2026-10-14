import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colourUtility, measure, planes } from "../../test/contrast";
import { Button } from "./button";

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

  const rest = colourUtility(classes, "bg-");
  const hover = colourUtility(classes, "hover:bg-");
  const text = colourUtility(classes, "text-");

  for (const scope of [":root", ".dark"] as const) {
    for (const [plane, base] of Object.entries(planes(scope))) {
      for (const [state, fill] of [["rest", rest], ["hover", hover]] as const) {
        it(`clears 4.5:1 in ${scope} on ${plane} at ${state}`, () => {
          expect(measure(scope, text, fill, base)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
