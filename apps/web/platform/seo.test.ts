import { describe, expect, it } from "vitest";
import { seoMetadata, sitemapEntries, robotsPolicy, serializeStructuredData } from "./seo";

describe("public search policy", () => {
  it("keeps canonicals and reciprocal language alternates aligned", () => {
    const vi = seoMetadata("/office", "vi");
    expect(vi.alternates).toEqual({ canonical: "/vi/office", languages: { en: "/office", vi: "/vi/office", "x-default": "/office" } });
    expect(vi.robots).toEqual({ index: true, follow: true });
    expect(seoMetadata("/features/tasks", "en").title).toMatch(/task/i);
    expect(seoMetadata("/office", "vi").title).toEqual({ absolute: "UniWork Office — soạn thảo, bảng tính và PDF với AI" });
  });
  it("publishes only production public pages in the sitemap", () => {
    expect(sitemapEntries("http://localhost:3000")).toEqual([]);
    expect(sitemapEntries("https://preview.uniworkos.com")).toEqual([]);
    const entries = sitemapEntries("https://uniworkos.com");
    expect(entries.some(entry => entry.url === "https://uniworkos.com/vi/office")).toBe(true);
    expect(entries.some(entry => /admin|login|share|invite/.test(entry.url))).toBe(false);
    expect(entries.every(entry => !entry.lastModified)).toBe(true);
  });
  it("leaves render resources crawlable and prevents preview indexing", () => {
    expect(robotsPolicy("http://localhost:3000").rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(robotsPolicy("https://uniworkos.com").sitemap).toBe("https://uniworkos.com/sitemap.xml");
  });
  it("cannot break out of the JSON-LD script", () => {
    expect(serializeStructuredData({ name: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});
