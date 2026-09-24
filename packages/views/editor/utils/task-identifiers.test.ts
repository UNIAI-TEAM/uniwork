import { describe, expect, it } from "vitest";
import {
  preprocessTaskIdentifiers,
  isTaskIdentifier,
} from "@uniwork/ui/markdown";

/**
 * Pure detector for the Linear-style issue-identifier autolink. Lives in
 * @uniwork/ui/markdown (no test runner there), exercised here where views'
 * vitest can reach it.
 */
describe("preprocessTaskIdentifiers", () => {
  it("rewrites a bare identifier into a canonical mention link", () => {
    expect(preprocessTaskIdentifiers("Related to UNI-0")).toBe(
      "Related to [UNI-0](mention://task/UNI-0)",
    );
  });

  it("rewrites multiple identifiers in one string", () => {
    expect(preprocessTaskIdentifiers("Created TES-1 and UNI-0")).toBe(
      "Created [TES-1](mention://task/TES-1) and [UNI-0](mention://task/UNI-0)",
    );
  });

  it("links an identifier at a sentence end (trailing dot + space)", () => {
    expect(preprocessTaskIdentifiers("See UNI-0. Done.")).toBe(
      "See [UNI-0](mention://task/UNI-0). Done.",
    );
  });

  it("links identifiers wrapped in prose punctuation", () => {
    expect(preprocessTaskIdentifiers("(UNI-0) and [UNI-0]")).toContain(
      "([UNI-0](mention://task/UNI-0))",
    );
  });

  // --- skip: code -------------------------------------------------------
  it("skips identifiers inside inline code", () => {
    expect(preprocessTaskIdentifiers("use `UNI-0` here")).toBe(
      "use `UNI-0` here",
    );
  });

  it("skips identifiers inside fenced code blocks", () => {
    const input = "```\nMUL-1 in code\n```";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  // --- skip: existing links / mentions ----------------------------------
  it("does not double-process an existing mention link", () => {
    const input = "[UNI-0](mention://task/00000000-0000-0000-0000-000000000001)";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  it("skips an identifier used as a markdown link label", () => {
    const input = "[UNI-0](https://example.com/x)";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  // --- skip: urls / filenames / paths -----------------------------------
  it("skips an identifier inside a URL", () => {
    const input = "https://example.com/board/UNI-0";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  it("skips a filename token like ABC-123.ts", () => {
    const input = "open ABC-123.ts now";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  it("skips a path segment like FOO-1/bar", () => {
    const input = "path FOO-1/bar/baz";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  // --- non-matches ------------------------------------------------------
  it("ignores lowercase tokens", () => {
    const input = "some-word-1 and mul-1";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  it("ignores a token embedded in a larger word", () => {
    const input = "XMUL-1A stays";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });

  it("returns input unchanged when no candidates exist", () => {
    const input = "plain text with no identifiers";
    expect(preprocessTaskIdentifiers(input)).toBe(input);
  });
});

describe("isTaskIdentifier", () => {
  it("accepts a bare identifier", () => {
    expect(isTaskIdentifier("UNI-0")).toBe(true);
    expect(isTaskIdentifier("TES-1")).toBe(true);
  });

  it("rejects a UUID (so real mentions are not treated as identifiers)", () => {
    expect(isTaskIdentifier("00000000-0000-0000-0000-000000000001")).toBe(
      false,
    );
  });

  it("rejects lowercase and malformed tokens", () => {
    expect(isTaskIdentifier("mul-1")).toBe(false);
    expect(isTaskIdentifier("MUL-")).toBe(false);
    expect(isTaskIdentifier("MUL1")).toBe(false);
  });
});
