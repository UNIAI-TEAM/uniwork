import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_PREFS, HOME_PRESETS, moveSection, normalizeHomePrefs, visibleSections } from "./prefs";

describe("normalizeHomePrefs", () => {
  it("gives the default layout for nothing, an empty object or a non-object", () => {
    expect(normalizeHomePrefs(undefined)).toEqual(DEFAULT_HOME_PREFS);
    expect(normalizeHomePrefs({})).toEqual(DEFAULT_HOME_PREFS);
    expect(normalizeHomePrefs(["stats"])).toEqual(DEFAULT_HOME_PREFS);
  });

  it("keeps known values and drops unknown keys, duplicates and wrong types", () => {
    const got = normalizeHomePrefs({
      enabled: { brief: false, stats: "no", ghost: true },
      order: ["inbox", "ghost", "inbox", 3, "mywork"],
      layout: "huge",
      extra: 1,
    });
    expect(got.enabled).toEqual({ ...DEFAULT_HOME_PREFS.enabled, brief: false });
    expect(got.order).toEqual(["inbox", "mywork", "stats", "upcoming", "brief"]);
    expect(got.layout).toBe("balanced");
  });

  it("returns every preset unchanged", () => {
    for (const preset of HOME_PRESETS) expect(normalizeHomePrefs(preset.prefs)).toEqual(preset.prefs);
  });
});

describe("moveSection", () => {
  const order = [...DEFAULT_HOME_PREFS.order];

  it("swaps with the neighbour in the given direction", () => {
    expect(moveSection(order, "upcoming", -1)).toEqual(["stats", "upcoming", "mywork", "inbox", "brief"]);
    expect(moveSection(order, "upcoming", 1)).toEqual(["stats", "mywork", "inbox", "upcoming", "brief"]);
  });

  it("leaves the order alone at either end", () => {
    expect(moveSection(order, "stats", -1)).toBe(order);
    expect(moveSection(order, "brief", 1)).toBe(order);
  });
});

describe("visibleSections", () => {
  it("lists enabled sections in the saved order", () => {
    const minimal = HOME_PRESETS.find((p) => p.key === "minimal")!.prefs;
    expect(visibleSections(minimal)).toEqual(["mywork"]);
    expect(visibleSections({ ...DEFAULT_HOME_PREFS, enabled: { ...DEFAULT_HOME_PREFS.enabled, stats: false } })).toEqual([
      "mywork", "upcoming", "inbox", "brief",
    ]);
  });
});
