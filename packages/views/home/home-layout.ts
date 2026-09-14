import type { HomeLayout, HomeSectionKey } from "@uniwork/core/home/prefs";

/**
 * Grid classes live in views, not core, so Tailwind's scan of this package
 * sees every class the home grid can take.
 */
export function homeGridClass(layout: HomeLayout): string {
  return layout === "compact" ? "mx-auto grid w-full max-w-3xl grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 xl:grid-cols-3";
}

/** Stats and brief always run full width; the density decides the rest. */
export function homeSpanClass(key: HomeSectionKey, layout: HomeLayout): string {
  if (layout === "compact") return "min-w-0";
  if (key === "stats" || key === "brief") return "min-w-0 xl:col-span-3";
  if (layout === "balanced") {
    if (key === "mywork") return "min-w-0 xl:col-span-2";
    if (key === "inbox") return "min-w-0 xl:col-span-3";
  }
  return "min-w-0";
}
