import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { readonlyKeys, readonlyReaderCanComment } from "./document-readonly-copy";

const { t } = initI18n();

describe("readonlyReaderCanComment", () => {
  it.each([
    ["comment", true],
    ["view", false],
    ["", false],
    [undefined, false],
    [null, false],
    ["edit", true],
    ["manage", true],
  ])("my_level %s -> %s", (level, expected) => {
    expect(readonlyReaderCanComment({ my_level: level as never })).toBe(expected);
  });

  it("is false for a shelved document at every level (it takes no comments)", () => {
    expect(readonlyReaderCanComment({ my_level: "comment", shelved_at: "2026-10-01T00:00:00Z" })).toBe(false);
  });
});

describe("readonlyKeys", () => {
  it("names the comment level for a reader who can comment, view only otherwise", () => {
    const view = readonlyKeys(false);
    const comment = readonlyKeys(true);
    expect(t(view.badge)).toBe(t("documents.save.readonly"));
    expect(t(comment.badge)).not.toBe(t("documents.save.readonly"));
    for (const key of [...Object.values(view), ...Object.values(comment)]) {
      expect(t(key)).not.toBe(key);
    }
  });
});
