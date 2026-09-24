import type { HomeLayout, HomeSectionKey } from "@uniwork/core/home/prefs";

/**
 * Grid classes live in views, not core, so Tailwind's scan of this package
 * sees every class the home grid can take. Balanced does not use a grid; see
 * `homeBalancedBands`.
 */
export function homeGridClass(layout: Exclude<HomeLayout, "balanced">): string {
  return layout === "compact" ? "mx-auto grid w-full max-w-3xl grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 xl:grid-cols-3";
}

/** Stats and brief always run full width; in wide every other section takes one column. */
export function homeSpanClass(key: HomeSectionKey, layout: Exclude<HomeLayout, "balanced">): string {
  if (layout === "compact") return "min-w-0";
  if (key === "stats" || key === "brief") return "min-w-0 xl:col-span-3";
  return "min-w-0";
}

/** The short sections: they sit beside the long lists instead of stretching to match them. */
const ASIDE_SECTIONS: ReadonlySet<HomeSectionKey> = new Set(["upcoming", "brief"]);

/** Spelled out so Tailwind sees every class; there are five sections at most. */
const ORDER_CLASS = ["order-1", "order-2", "order-3", "order-4", "order-5"] as const;

export interface HomePlaced {
  key: HomeSectionKey;
  /** Keeps the person's own order once the columns dissolve below `xl`. */
  orderClass: string;
}

export type HomeBand = { kind: "row"; key: HomeSectionKey } | { kind: "split"; main: HomePlaced[]; aside: HomePlaced[] };

/**
 * Balanced density. The day's figures run full width; the sections between
 * them split into a main column (my work, inbox) and an aside (upcoming,
 * brief), so a three-row meeting list never stretches beside an eight-row task
 * list. A run with nothing for one side stays a single column. Below `xl` the
 * columns dissolve and each section's order class restores the saved order.
 */
export function homeBalancedBands(keys: readonly HomeSectionKey[]): HomeBand[] {
  const bands: HomeBand[] = [];
  let run: HomeSectionKey[] = [];
  const flush = () => {
    const placed = run.map((key, i) => ({ key, orderClass: ORDER_CLASS[i] ?? "" }));
    const main = placed.filter((p) => !ASIDE_SECTIONS.has(p.key));
    const aside = placed.filter((p) => ASIDE_SECTIONS.has(p.key));
    if (main.length > 0 && aside.length > 0) bands.push({ kind: "split", main, aside });
    else for (const p of placed) bands.push({ kind: "row", key: p.key });
    run = [];
  };
  for (const key of keys) {
    if (key === "stats") {
      flush();
      bands.push({ kind: "row", key });
    } else {
      run.push(key);
    }
  }
  flush();
  return bands;
}
