"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";

const SECTION_PARAM = "section";
/** Section name in the URL → id of the heading the page scrolls to. */
const SECTION_ANCHORS: Record<string, string> = { summary: "summary-heading", "action-items": "action-items-heading", transcript: "transcript-heading", minutes: "meeting-minutes-heading" };

/** Bring a section's heading to the top: smooth, unless the reader asked for less motion. */
export function scrollSectionIntoView(el: Element): void {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
}

/**
 * `/meetings/<id>?section=summary` (or `action-items`, `transcript`) scrolls the detail page
 * to that panel once the meeting has loaded (the panel is data-driven, inside an inner
 * scroller, so a native #hash cannot do it), and focus lands on its heading
 * so the keyboard and a screen reader start there too. The param is dropped once used,
 * so a reload does not jump again. Where a notification lands (C-11 §9.1 V1).
 */
export function useMeetingSectionDeepLink({ ready }: { ready: boolean }): void {
  const nav = useOptionalNavigation();
  const section = nav?.searchParams.get(SECTION_PARAM) ?? "";
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Once the param is gone, the same section may be linked again (a second citation).
    if (!section) handled.current = null;
    if (!nav || !section || !ready || handled.current === section) return;
    handled.current = section;
    const anchor = SECTION_ANCHORS[section];
    const heading = anchor ? document.getElementById(anchor) : null;
    if (heading) {
      scrollSectionIntoView(heading);
      // Focusable by script only, so the heading never joins the tab order.
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    const params = new URLSearchParams(nav.searchParams);
    params.delete(SECTION_PARAM);
    // The transcript card reads ?segment= (a cited line) in the same pass.
    params.delete("segment");
    const qs = params.toString();
    nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
  }, [nav, ready, section]);
}
