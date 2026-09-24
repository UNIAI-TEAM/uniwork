import { describe, expect, it } from "vitest";
import { homeBalancedBands, homeGridClass, homeSpanClass } from "./home-layout";

describe("home layout classes", () => {
  it("compact is one narrow column where every section spans it", () => {
    expect(homeGridClass("compact")).toContain("grid-cols-1");
    expect(homeGridClass("compact")).not.toContain("xl:grid-cols-3");
    for (const key of ["stats", "mywork", "upcoming", "inbox", "brief"] as const) {
      expect(homeSpanClass(key, "compact")).toBe("min-w-0");
    }
  });

  it("wide gives my work, upcoming and inbox one column each", () => {
    expect(homeGridClass("wide")).toContain("xl:grid-cols-3");
    expect(homeSpanClass("mywork", "wide")).toBe("min-w-0");
    expect(homeSpanClass("inbox", "wide")).toBe("min-w-0");
    expect(homeSpanClass("stats", "wide")).toContain("xl:col-span-3");
  });
});

describe("homeBalancedBands", () => {
  it("puts the long lists in the main column and the short ones beside them", () => {
    expect(homeBalancedBands(["stats", "mywork", "upcoming", "inbox", "brief"])).toEqual([
      { kind: "row", key: "stats" },
      {
        kind: "split",
        main: [
          { key: "mywork", orderClass: "order-1" },
          { key: "inbox", orderClass: "order-3" },
        ],
        aside: [
          { key: "upcoming", orderClass: "order-2" },
          { key: "brief", orderClass: "order-4" },
        ],
      },
    ]);
  });

  it("lets the stats break the columns where the person placed them", () => {
    const bands = homeBalancedBands(["mywork", "upcoming", "stats", "inbox", "brief"]);
    expect(bands.map((b) => (b.kind === "row" ? b.key : "split"))).toEqual(["split", "stats", "split"]);
  });

  it("keeps a run with one side empty as single full-width rows", () => {
    expect(homeBalancedBands(["stats", "mywork", "inbox"])).toEqual([
      { kind: "row", key: "stats" },
      { kind: "row", key: "mywork" },
      { kind: "row", key: "inbox" },
    ]);
  });
});
