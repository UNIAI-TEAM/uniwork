import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

/**
 * The app proxies the Office frame's AI routes to the API origin
 * (`platform/office-frame/frame-asset-rewrites.mjs`), and Next's external-rewrite
 * proxy cuts a silent upstream after `experimental.proxyTimeout` (default 30000,
 * `next/dist/server/lib/router-utils/proxy-request.js`: `proxyTimeout || 30000`,
 * armed as a socket inactivity timeout). A UniWork AI turn is one SSE body written
 * only when the turn ends (`server/internal/ai/openai_facade.go` WriteUniworkSSE)
 * and the turn's budget is 55 s (`server/internal/service/ai_uniwork.go`
 * UniworkDeadline), so the default would cut a slow real turn. This pins the
 * configured value above that deadline.
 */
const UNIWORK_DEADLINE_MS = 55_000;

describe("next.config experimental.proxyTimeout", () => {
  it("is set above the UniWork AI turn deadline, so the rewrite does not cut a slow turn", () => {
    const timeout = nextConfig.experimental?.proxyTimeout;
    expect(timeout, "experimental.proxyTimeout is unset: the frame AI rewrite falls back to Next's 30000 ms inactivity timeout, below the 55000 ms UniworkDeadline").toBeTypeOf("number");
    expect(timeout, `experimental.proxyTimeout is ${timeout} ms, at or below the ${UNIWORK_DEADLINE_MS} ms UniworkDeadline`).toBeGreaterThan(UNIWORK_DEADLINE_MS);
  });
});
