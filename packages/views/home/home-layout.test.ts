import { describe, expect, it } from "vitest";
import { homeGridClass, homeSpanClass } from "./home-layout";

describe("home layout classes", () => {
  it("compact is one narrow column where every section spans it", () => {
    expect(homeGridClass("compact")).toContain("grid-cols-1");
    expect(homeGridClass("compact")).not.toContain("xl:grid-cols-3");
    for (const key of ["stats", "mywork", "upcoming", "inbox", "brief"] as const) {
      expect(homeSpanClass(key, "compact")).toBe("min-w-0");
    }
  });

  it("balanced puts my work beside upcoming and the inbox under both", () => {
    expect(homeGridClass("balanced")).toContain("xl:grid-cols-3");
    expect(homeSpanClass("mywork", "balanced")).toContain("xl:col-span-2");
    expect(homeSpanClass("upcoming", "balanced")).toBe("min-w-0");
    expect(homeSpanClass("inbox", "balanced")).toContain("xl:col-span-3");
    expect(homeSpanClass("brief", "balanced")).toContain("xl:col-span-3");
  });

  it("wide gives my work, upcoming and inbox one column each", () => {
    expect(homeGridClass("wide")).toContain("xl:grid-cols-3");
    expect(homeSpanClass("mywork", "wide")).toBe("min-w-0");
    expect(homeSpanClass("inbox", "wide")).toBe("min-w-0");
    expect(homeSpanClass("stats", "wide")).toContain("xl:col-span-3");
  });
});
