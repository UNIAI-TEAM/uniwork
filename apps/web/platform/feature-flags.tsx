"use client";

import { useEffect, type ReactNode } from "react";
import { PublicConfigFlagsProvider, usePublicConfig } from "@uniwork/core/feature-flags";

/**
 * The web host's flag source (F-11 §7.2): one org-less GET /api/v1/config at
 * boot, mounted by PublicConfigFlagsProvider; the workspace shell nests one
 * asked for its organization. The same payload carries the RUM sample rate,
 * so web-vitals reporting starts here too.
 */
export function WebFeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { data } = usePublicConfig();
  useEffect(() => {
    if (!data || !data.flags["rum_sampling"]) return;
    // Loaded on demand: web-vitals is not on every route's critical path,
    // and the initial-JS budget (250 KB gzip) sits right at the line.
    let live = true;
    void import("./rum").then((m) => { if (live) m.startWebVitals(data.rum_sample_rate); });
    return () => { live = false; };
  }, [data]);
  return <PublicConfigFlagsProvider>{children}</PublicConfigFlagsProvider>;
}
