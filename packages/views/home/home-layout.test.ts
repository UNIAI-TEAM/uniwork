import { describe, expect, it } from "vitest";
import { homeBands } from "./home-layout";

const ALL = ["stats", "mywork", "upcoming", "inbox"] as const;

describe("homeBands", () => {
  it("compact stacks every section in one column", () => {
    expect(homeBands(ALL, "compact")).toEqual(ALL.map((key) => ({ kind: "row", key })));
  });

  it("balanced puts my work beside the short lists, in the saved order", () => {
    expect(homeBands(["stats", "upcoming", "mywork", "inbox"], "balanced")).toEqual([
      { kind: "row", key: "stats" },
      { kind: "split", keys: ["upcoming", "mywork", "inbox"], asideRows: 2 },
    ]);
  });

  it("lets the stats break the columns where the person placed them", () => {
    const bands = homeBands(["mywork", "upcoming", "stats", "inbox"], "balanced");
    expect(bands.map((b) => b.kind)).toEqual(["split", "row", "row"]);
  });

  it("keeps a run with one side empty as single full-width rows", () => {
    expect(homeBands(["stats", "upcoming", "inbox"], "balanced")).toEqual([
      { kind: "row", key: "stats" },
      { kind: "row", key: "upcoming" },
      { kind: "row", key: "inbox" },
    ]);
  });

  it("wide gives each visible section a column, my work twice as wide, and leaves no empty track", () => {
    expect(homeBands(ALL, "wide")).toEqual([
      { kind: "row", key: "stats" },
      { kind: "columns", keys: ["mywork", "upcoming", "inbox"], template: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)" },
    ]);
    expect(homeBands(["stats", "upcoming", "inbox"], "wide")).toEqual([
      { kind: "row", key: "stats" },
      { kind: "columns", keys: ["upcoming", "inbox"], template: "minmax(0,1fr) minmax(0,1fr)" },
    ]);
    expect(homeBands(["mywork", "stats"], "wide")).toEqual([
      { kind: "row", key: "mywork" },
      { kind: "row", key: "stats" },
    ]);
  });
});
