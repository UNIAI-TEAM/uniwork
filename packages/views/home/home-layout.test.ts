import { describe, expect, it } from "vitest";
import { homeBalancedBands, homeGridClass, homeSpanClass } from "./home-layout";

describe("home layout classes", () => {
  it("compact is one narrow column where every section spans it", () => {
    expect(homeGridClass("compact")).toContain("grid-cols-1");
    expect(homeGridClass("compact")).not.toContain("xl:grid-cols-4");
    for (const key of ["stats", "mywork", "upcoming", "inbox"] as const) {
      expect(homeSpanClass(key, "compact")).toBe("min-w-0");
    }
  });

  it("wide lines my work, upcoming and inbox up with the four stat tiles", () => {
    expect(homeGridClass("wide")).toContain("xl:grid-cols-4");
    expect(homeSpanClass("mywork", "wide")).toContain("xl:col-span-2");
    expect(homeSpanClass("inbox", "wide")).toBe("min-w-0");
    expect(homeSpanClass("stats", "wide")).toContain("xl:col-span-4");
  });
});

describe("homeBalancedBands", () => {
  it("puts my work in the main column and the short lists beside it", () => {
    expect(homeBalancedBands(["stats", "mywork", "upcoming", "inbox"])).toEqual([
      { kind: "row", key: "stats" },
      {
        kind: "split",
        main: [{ key: "mywork", orderClass: "order-1" }],
        aside: [
          { key: "upcoming", orderClass: "order-2" },
          { key: "inbox", orderClass: "order-3" },
        ],
      },
    ]);
  });

  it("lets the stats break the columns where the person placed them", () => {
    const bands = homeBalancedBands(["mywork", "upcoming", "stats", "inbox"]);
    expect(bands.map((b) => (b.kind === "row" ? b.key : "split"))).toEqual(["split", "stats", "inbox"]);
  });

  it("keeps a run with one side empty as single full-width rows", () => {
    expect(homeBalancedBands(["stats", "upcoming", "inbox"])).toEqual([
      { kind: "row", key: "stats" },
      { kind: "row", key: "upcoming" },
      { kind: "row", key: "inbox" },
    ]);
  });
});
