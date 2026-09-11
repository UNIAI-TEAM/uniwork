import { afterAll, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { formatTypingLabel } from "./typing-indicator";

const i18n = initI18n();

describe("formatTypingLabel", () => {
  it("returns null for empty list", () => {
    expect(formatTypingLabel([], i18n.t.bind(i18n), "vi")).toBeNull();
  });

  it("shows a single name", () => {
    expect(formatTypingLabel(["B"], i18n.t.bind(i18n), "vi")).toBe("B đang nhập…");
  });

  it("lists multiple names in Vietnamese", async () => {
    await setLocale("vi");
    expect(formatTypingLabel(["B", "C"], i18n.t.bind(i18n), "vi")).toBe("B và C đang nhập…");
    expect(formatTypingLabel(["A", "B", "C"], i18n.t.bind(i18n), "vi")).toBe("A, B và C đang nhập…");
  });

  // English is not in the initial bundle any more; setLocale fetches it first.
  it("lists multiple names in English", async () => {
    await setLocale("en");
    expect(formatTypingLabel(["Alice", "Bob"], i18n.t.bind(i18n), "en")).toBe(
      "Alice and Bob are typing…",
    );
  });
});

afterAll(async () => {
  await setLocale("vi");
});
