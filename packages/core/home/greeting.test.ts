import { describe, expect, it } from "vitest";
import { greetingName } from "./greeting";

describe("greetingName", () => {
  it("calls a Vietnamese name by its last word, with or without diacritics", () => {
    expect(greetingName("Phan Đức Quang")).toBe("Quang");
    expect(greetingName("Nguyen Van An")).toBe("An");
    expect(greetingName("  Đặng   Thu  Thảo ")).toBe("Thảo");
  });

  it("calls a given-first name by its first word", () => {
    expect(greetingName("Anna Lee")).toBe("Anna");
  });

  it("keeps a one-word name whole", () => {
    expect(greetingName("Quang")).toBe("Quang");
    expect(greetingName("")).toBe("");
  });
});
