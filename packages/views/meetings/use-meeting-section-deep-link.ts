"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";

const SECTION_PARAM = "section";
/** Section name in the URL → id of the heading the page scrolls to. */
const SECTION_ANCHORS: Record<string, string> = { summary: "summary-heading" };

/**
 * `/meetings/<id>?section=summary` scrolls the detail page to its summary
 * panel once the meeting has loaded (the panel is data-driven, inside an inner
 * scroller, so a native #hash cannot do it). The param is dropped once used,
 * so a reload does not jump again. Where a notification lands (C-11 §9.1 V1).
 */
export function useMeetingSectionDeepLink({ ready }: { ready: boolean }): void {
  const nav = useOptionalNavigation();
  const section = nav?.searchParams.get(SECTION_PARAM) ?? "";
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!nav || !section || !ready || handled.current === section) return;
    handled.current = section;
    const anchor = SECTION_ANCHORS[section];
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" });
    const params = new URLSearchParams(nav.searchParams);
    params.delete(SECTION_PARAM);
    const qs = params.toString();
    nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
  }, [nav, ready, section]);
}
