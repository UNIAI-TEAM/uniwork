import { describe, expect, it } from "vitest";
import { marketingRoute } from "@uniwork/core/paths";
import { APP_REDIRECTS } from "./app-redirects.mjs";

describe("the pre-/apps URLs", () => {
  it("redirect permanently to the app pages, in both locales", () => {
    expect(APP_REDIRECTS).toEqual([
      { source: "/office", destination: "/apps/office", permanent: true },
      { source: "/vi/office", destination: "/vi/apps/office", permanent: true },
      { source: "/unichat", destination: "/apps/unichat", permanent: true },
      { source: "/vi/unichat", destination: "/vi/apps/unichat", permanent: true },
    ]);
  });

  it("land on a catalogued public page and never on themselves", () => {
    for (const { source, destination } of APP_REDIRECTS) {
      expect(marketingRoute(destination), destination).not.toBeNull();
      expect(marketingRoute(source), source).toBeNull();
    }
  });
});
