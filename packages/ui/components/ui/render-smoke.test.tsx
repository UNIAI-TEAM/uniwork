import { afterEach, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, isValidElement, type ComponentType } from "react";
import { cleanup, render } from "@testing-library/react";

/**
 * Import and mount every primitive in this directory once.
 *
 * There are no unit tests behind these primitives — they are vendored from a
 * shadcn / Base UI registry — so nothing else would notice that one is broken.
 * Two things are checked, and they catch different failures:
 *
 *  1. The module imports. This is the real bulk-copy risk: a missing
 *     dependency, a path that did not get rewritten, a file that was never
 *     copied. `tsc` catches most of it, but not a package that type-resolves
 *     from a stale declaration and is absent at runtime.
 *
 *  2. The ROOT component mounts. Only the root — these are compound
 *     primitives, and `AccordionItem` outside `Accordion` is supposed to
 *     throw. Mounting every export would assert something false and turn the
 *     exemption list into noise.
 *
 * A root that genuinely cannot stand alone goes in NEEDS_PARENT with the
 * reason. That list is documentation, not a mute button.
 */
const NEEDS_PARENT = new Map<string, string>([
  [
    "sidebar",
    "Sidebar reads layout state from SidebarProvider and throws by design outside it.",
  ],
  [
    "data-table",
    "DataTable requires the TanStack `table` instance as a prop; there is no meaningful default.",
  ],
  [
    "data-table-column-header",
    "Requires a TanStack `column` prop to read sort state from.",
  ],
]);

const DIR = resolve(process.cwd(), "components/ui");

/** `alert-dialog.tsx` → `AlertDialog`. The registry names roots this way. */
function rootName(file: string): string {
  return file
    .replace(/\.tsx$/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .sort();

afterEach(cleanup);

describe("every primitive", () => {
  it("is the full ported set", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    // A generous timeout on purpose: the first import of a heavy primitive
    // (calendar, chart, command) pulls recharts / cmdk / date-fns through the
    // transform pipeline, and under `make check` this suite shares the CPU
    // with two other vitest workers and a -race Go build. It passed in 1.5s
    // alone and tripped the 5s default under that load.
    it(name, { timeout: 30_000 }, async () => {
      const mod = (await import(`./${name}`)) as Record<string, unknown>;
      const exports = Object.keys(mod);
      expect(exports.length, `${name} exports nothing`).toBeGreaterThan(0);

      const root = mod[rootName(file)];
      if (typeof root !== "function" || NEEDS_PARENT.has(name)) return;

      const el = createElement(root as ComponentType);
      if (!isValidElement(el)) return;
      // Whatever throws here would throw the same way the first time a screen
      // rendered this primitive.
      render(el);
    });
  }
});
