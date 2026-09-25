import type { HomeLayout, HomeSectionKey } from "@uniwork/core/home/prefs";

/** The companion sections: they sit beside my work instead of below it. */
const ASIDE_SECTIONS: ReadonlySet<HomeSectionKey> = new Set(["upcoming", "inbox"]);

export type HomeBand =
  | { kind: "row"; key: HomeSectionKey }
  /** Balanced: my work in a main column, the short lists stacked beside it. */
  | { kind: "split"; keys: HomeSectionKey[]; asideRows: number }
  /** Wide: every section of the run in its own column, my work twice as wide. */
  | { kind: "columns"; keys: HomeSectionKey[]; template: string };

/**
 * How the visible sections are laid out. The day's figures always run full
 * width and break the page into runs; what happens to a run depends on the
 * density. Every band keeps the sections in the person's own order in the
 * DOM, so reading and tab order match the order they chose; only the columns
 * move things side by side, and only once the page itself is wide enough
 * (a container query in the view, not the viewport).
 */
export function homeBands(keys: readonly HomeSectionKey[], layout: HomeLayout): HomeBand[] {
  const bands: HomeBand[] = [];
  let run: HomeSectionKey[] = [];
  const flush = () => {
    const aside = run.filter((key) => ASIDE_SECTIONS.has(key));
    if (layout === "balanced" && aside.length > 0 && aside.length < run.length) {
      bands.push({ kind: "split", keys: run, asideRows: aside.length });
    } else if (layout === "wide" && run.length > 1) {
      const template = run.map((key) => (ASIDE_SECTIONS.has(key) ? "minmax(0,1fr)" : "minmax(0,2fr)")).join(" ");
      bands.push({ kind: "columns", keys: run, template });
    } else {
      for (const key of run) bands.push({ kind: "row", key });
    }
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

/** Whether a section of a split band goes in the aside column. */
export function isHomeAside(key: HomeSectionKey): boolean {
  return ASIDE_SECTIONS.has(key);
}
