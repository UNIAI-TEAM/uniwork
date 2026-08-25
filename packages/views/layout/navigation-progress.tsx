"use client";

import { useEffect, useState } from "react";
import { useIsNavigating } from "../navigation";

/**
 * 2px top-of-content progress bar while a transition-wrapped push/replace is
 * mid-flight. Indeterminate by design — we know a route is coming, not when.
 * The container stays mounted so it can fade out instead of vanishing in one
 * frame; the sweep is mounted only while navigating so its infinite keyframe
 * does not paint while hidden.
 */
export function NavigationProgress() {
  const isNavigating = useIsNavigating();
  const [renderSweep, setRenderSweep] = useState(false);

  useEffect(() => {
    if (isNavigating) setRenderSweep(true);
  }, [isNavigating]);

  return (
    <div
      aria-hidden
      data-visible={isNavigating ? "true" : "false"}
      onTransitionEnd={(event) => {
        if (event.propertyName === "opacity" && !isNavigating) setRenderSweep(false);
      }}
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100"
    >
      {renderSweep && <div className="h-full w-1/3 animate-nav-progress-sweep bg-brand" />}
    </div>
  );
}
