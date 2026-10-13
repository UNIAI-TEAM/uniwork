import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import vi from "../i18n/locales/vi.json";
import { CHANGELOG_RELEASES, groupReleasesByMonth, type Release } from "./releases";

function lookup(object: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, object);
}
describe("public release catalogue", () => {
  it("keeps unique stable anchors and complete bilingual release content", () => {
    const ids = new Set<string>();
    for (const release of CHANGELOG_RELEASES) {
      expect(release.id).toBe("release-" + release.version.replaceAll(".", "-"));
      expect(ids.has(release.id)).toBe(false);
      ids.add(release.id);
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(new Date(release.date + "T00:00:00Z").toISOString().slice(0, 10)).toBe(release.date);
      expect(release.sourceRef).toMatch(/^[0-9a-f]{40}$/);
      for (const dictionary of [en, vi]) {
        const prefix = "changelog.releases." + release.contentKey;
        expect(lookup(dictionary, prefix + ".title")).toEqual(expect.any(String));
        expect(lookup(dictionary, prefix + ".summary")).toEqual(expect.any(String));
        for (const section of release.sections) {
          expect(["features", "improvements", "fixes"]).toContain(section.kind);
          for (const item of section.items) expect(lookup(dictionary, prefix + "." + section.kind + "." + item)).toEqual(expect.any(String));
        }
      }
    }
    expect(CHANGELOG_RELEASES.some((release) => release.version === "1.0.0")).toBe(true);
  });
  it("groups newest releases first without changing the source", () => {
    const base = CHANGELOG_RELEASES[0]!;
    const records: Release[] = [{ ...base, date: "2026-09-12", id: "older" }, { ...base, date: "2026-10-12", id: "newer" }];
    expect(groupReleasesByMonth(records).map((group) => group.month)).toEqual(["2026-10", "2026-09"]);
    expect(records[0]?.id).toBe("older");
  });
});
