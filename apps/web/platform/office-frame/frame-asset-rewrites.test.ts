import { describe, expect, it } from "vitest";
import { officeFrameAssetRewrites } from "./frame-asset-rewrites.mjs";

describe("officeFrameAssetRewrites", () => {
  it("proxies only the signed asset and linked byte routes to the API origin", () => {
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
    ]);
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
