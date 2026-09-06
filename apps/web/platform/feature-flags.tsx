"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
  usePublicConfig,
  type Rule,
} from "@uniwork/core/feature-flags";
import { startWebVitals } from "./rum";

/**
 * The web host's flag source (F-11 §7.2): one GET /api/v1/config at boot,
 * turned into a StaticProvider for @uniwork/core/feature-flags. Until the
 * answer arrives every useFlag() returns its default, which is the same
 * thing the server does without a flag file. The same payload carries the
 * RUM sample rate, so web-vitals reporting starts here too.
 */
export function WebFeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { data } = usePublicConfig();
  const service = useMemo(() => {
    const rules: Record<string, Rule> = {};
    for (const [key, value] of Object.entries(data?.flags ?? {})) rules[key] = { default: value };
    return new FeatureFlagService(new StaticProvider(rules));
  }, [data]);
  useEffect(() => {
    if (!data || !data.flags["rum_sampling"]) return;
    return startWebVitals(data.rum_sample_rate);
  }, [data]);
  return <FeatureFlagsProvider service={service}>{children}</FeatureFlagsProvider>;
}
