import { describe, expect, it } from "vitest";
import { marketingHref, marketingRoute, MARKETING_ROUTES } from "./marketing";

describe("public marketing URLs", () => {
  it("localizes only public URLs and preserves fragments and queries", () => {
    expect(marketingHref("/office#office-download", "vi")).toBe("/vi/office#office-download");
    expect(marketingHref("/?utm_source=test#platform", "vi")).toBe("/vi?utm_source=test#platform");
    expect(marketingHref("/vi/features/tasks", "en")).toBe("/features/tasks");
    for (const href of ["/login", "/acme/team/tasks", "#questions", "https://example.com/office", "//example.com", "mailto:a@example.com"]) {
      expect(marketingHref(href, "vi")).toBe(href);
    }
  });
  it("accepts only catalogued pages, not arbitrary subtrees", () => {
    expect(marketingRoute("/vi/office")?.locale).toBe("vi");
    expect(marketingRoute("/changelog")?.locale).toBe("en");
    for (const path of ["/vi/admin", "/features/not-a-feature", "/office/private", "/vi/vi/office"]) expect(marketingRoute(path)).toBeNull();
    expect(new Set(MARKETING_ROUTES.map(route => route.path)).size).toBe(MARKETING_ROUTES.length);
  });
});
