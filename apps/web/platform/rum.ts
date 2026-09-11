import { onCLS, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { postWebVital, type WebVitalName } from "@uniwork/core/api/endpoints/config";
import { routePattern } from "@uniwork/core/paths";

const NAMES: Record<Metric["name"], WebVitalName | undefined> = {
  LCP: "lcp", INP: "inp", CLS: "cls", TTFB: "ttfb", FCP: undefined,
};

/**
 * Report web-vitals to POST /api/v1/rum (F-11 §2.8). One coin flip per page
 * load decides whether this session reports at all; the route is the
 * pattern, never the path. Returns a no-op stop function — web-vitals has
 * no unsubscribe, so a second call after the first is guarded by the flag.
 */
export function startWebVitals(sampleRate: number): () => void {
  if (typeof window === "undefined" || sampleRate <= 0 || Math.random() >= sampleRate) return () => {};
  const report = (m: Metric) => {
    const name = NAMES[m.name];
    if (!name) return;
    void postWebVital(name, m.value, routePattern(window.location.pathname)).catch(() => {});
  };
  onLCP(report);
  onINP(report);
  onCLS(report);
  onTTFB(report);
  return () => {};
}
