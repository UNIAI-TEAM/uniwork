import { describe, expect, it } from "vitest";
import { officeFrameAssetRewrites } from "./frame-asset-rewrites.mjs";

/** The route pattern a rule's source is, as a matcher: `:p(re)` becomes `(re)`, `:p*` a catch-all. */
function sourceMatcher(source: string): RegExp {
  return new RegExp(`^${source.replace(/:(\w+)\(([^)]+)\)/g, "($2)").replace(/:(\w+)\*/g, "(.+)")}$`);
}

describe("officeFrameAssetRewrites", () => {
  it("proxies the signed asset, linked and frame AI routes to the API origin", () => {
    const rules = officeFrameAssetRewrites("https://api.example.test/some/path");
    expect(rules).toEqual([
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/assets/:assetId([0-9A-HJKMNP-TV-Z]{26})",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/assets/:assetId",
      },
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/linked/:linkedId([0-9A-HJKMNP-TV-Z]{26})",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/linked/:linkedId",
      },
      {
        source: "/api/v1/office-frame/documents/:documentId([0-9A-HJKMNP-TV-Z]{26})/ai/:aiPath*",
        destination: "https://api.example.test/api/v1/office-frame/documents/:documentId/ai/:aiPath*",
      },
    ]);
  });

  it("proxies the frame AI routes, so the frame's same-origin POST reaches the API on a split-origin setup", () => {
    const ai = officeFrameAssetRewrites("https://api.example.test").find((rule) => rule.source.includes("/ai/"));
    expect(ai, "no rewrite maps the frame AI path to the API origin").toBeDefined();
    const re = sourceMatcher(ai!.source);
    const doc = "01M4KH88167D722JAC9EAPKN33";
    expect(re.test(`/api/v1/office-frame/documents/${doc}/ai/uniwork/chat/completions`)).toBe(true);
    expect(re.test(`/api/v1/office-frame/documents/${doc}/ai/cloud`)).toBe(true);
    expect(re.test(`/api/v1/office-frame/documents/${doc}/ai/byok/openai/chat/completions`)).toBe(true);
  });

  it("the frame AI rewrite matches ULID ids only, never a non-ULID document id or a non-frame path", () => {
    const ai = officeFrameAssetRewrites("https://api.example.test").find((rule) => rule.source.includes("/ai/"));
    const re = sourceMatcher(ai!.source);
    expect(re.test("/api/v1/office-frame/documents/not-a-ulid/ai/cloud")).toBe(false);
    expect(re.test("/api/v1/office-frame/documents/01M4KH88167D722JAC9EAPKN3I/ai/cloud")).toBe(false);
    expect(re.test("/api/v1/documents/01M4KH88167D722JAC9EAPKN33/ai/uniwork/chat/completions")).toBe(false);
    expect(re.test("/api/v1/documents/01M4KH88167D722JAC9EAPKN33/ai/cloud")).toBe(false);
  });

  it("matches ULIDs only, so no other frame route (sign, open, content) goes through the app", () => {
    const [assets] = officeFrameAssetRewrites("http://localhost:8080");
    const pattern = assets!.source.replace(/:(\w+)\(([^)]+)\)/g, "($2)");
    const re = new RegExp(`^${pattern}$`);
    expect(re.test("/api/v1/office-frame/documents/01M4KH88167D722JAC9EAPKN33/assets/01M4KH881EA6RCD6K40C56YBTF")).toBe(true);
    expect(re.test("/api/v1/office-frame/documents/01M4KH88167D722JAC9EAPKN33/assets/sign")).toBe(false);
    expect(re.test("/api/v1/office-frame/documents/01M4KH88167D722JAC9EAPKN33/content")).toBe(false);
  });

  it("adds nothing for an unusable API URL", () => {
    expect(officeFrameAssetRewrites("not a url")).toEqual([]);
    expect(officeFrameAssetRewrites("")).toEqual([]);
  });
});
