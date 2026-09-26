import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_PREFS, HOME_PRESETS, activePreset, moveSection, normalizeHomePrefs, visibleSections } from "./prefs";

describe("normalizeHomePrefs", () => {
  it("gives the default layout for nothing, an empty object or a non-object", () => {
    expect(normalizeHomePrefs(undefined)).toEqual(DEFAULT_HOME_PREFS);
    expect(normalizeHomePrefs({})).toEqual(DEFAULT_HOME_PREFS);
    expect(normalizeHomePrefs(["stats"])).toEqual(DEFAULT_HOME_PREFS);
  });

  it("keeps known values and drops unknown keys, duplicates and wrong types", () => {
    const got = normalizeHomePrefs({
      enabled: { inbox: false, stats: "no", brief: false, ghost: true },
      order: ["inbox", "ghost", "brief", "inbox", 3, "mywork"],
      layout: "huge",
      extra: 1,
    });
    expect(got.enabled).toEqual({ ...DEFAULT_HOME_PREFS.enabled, inbox: false });
    expect(got.order).toEqual(["inbox", "mywork", "stats", "upcoming"]);
    expect(got.layout).toBe("balanced");
  });

  it("returns every preset unchanged", () => {
    for (const preset of HOME_PRESETS) expect(normalizeHomePrefs(preset.prefs)).toEqual(preset.prefs);
  });
});

describe("moveSection", () => {
  const order = [...DEFAULT_HOME_PREFS.order];

  it("swaps with the neighbour in the given direction", () => {
    expect(moveSection(order, "upcoming", -1)).toEqual(["stats", "upcoming", "mywork", "inbox"]);
    expect(moveSection(order, "upcoming", 1)).toEqual(["stats", "mywork", "inbox", "upcoming"]);
  });

  it("leaves the order alone at either end", () => {
    expect(moveSection(order, "stats", -1)).toBe(order);
    expect(moveSection(order, "inbox", 1)).toBe(order);
  });
});

describe("visibleSections", () => {
  it("lists enabled sections in the saved order", () => {
    const minimal = HOME_PRESETS.find((p) => p.key === "minimal")!.prefs;
    expect(visibleSections(minimal)).toEqual(["mywork"]);
    expect(visibleSections({ ...DEFAULT_HOME_PREFS, enabled: { ...DEFAULT_HOME_PREFS.enabled, stats: false } })).toEqual([
      "mywork", "upcoming", "inbox",
    ]);
  });
});

describe("activePreset", () => {
  it("names the preset the layout matches, and nothing once it is changed", () => {
    const doer = HOME_PRESETS.find((p) => p.key === "doer")!.prefs;
    expect(activePreset(doer)).toBe("doer");
    expect(activePreset({ ...doer, layout: "wide" })).toBeUndefined();
  });
});
