import { describe, expect, it } from "vitest";
import { pageStructuredData, seoMetadata, sitemapEntries, robotsPolicy, serializeStructuredData } from "./seo";

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
  it("publishes the UniChat page in both languages with its own application entry", () => {
    expect(seoMetadata("/unichat", "vi").alternates).toEqual({ canonical: "/vi/unichat", languages: { en: "/unichat", vi: "/vi/unichat", "x-default": "/unichat" } });
    expect(seoMetadata("/unichat", "en").title).toEqual({ absolute: expect.stringMatching(/^UniChat/) });
    const urls = sitemapEntries("https://uniworkos.com").map(entry => entry.url);
    expect(urls).toEqual(expect.arrayContaining(["https://uniworkos.com/unichat", "https://uniworkos.com/vi/unichat"]));
    const graph = pageStructuredData("/unichat", "vi", "https://uniworkos.com")?.["@graph"] ?? [];
    const app = graph.find(node => node["@type"] === "SoftwareApplication");
    expect(app).toMatchObject({ name: "UniChat", url: "https://uniworkos.com/vi/unichat", applicationCategory: "BusinessApplication", operatingSystem: "Windows, macOS, Linux, iOS, Android" });
    // The Office entry stays Office's own.
    expect(pageStructuredData("/office", "en", "https://uniworkos.com")?.["@graph"].find(node => node["@type"] === "SoftwareApplication")).toMatchObject({ name: "UniWork Office", operatingSystem: "Windows, macOS, Linux" });
  });
  it("cannot break out of the JSON-LD script", () => {
    expect(serializeStructuredData({ name: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});
