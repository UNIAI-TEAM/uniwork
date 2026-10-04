// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createMarkdownEditorExtensions } from "./extensions";
import { createMarkdownSourceCodec, createMarkdownSourceManager, toEditorDocument } from "./serialize";
import { escapeSelectiveMarkdownText } from "./escape";

/**
 * The kitchen-sink fixture. Every construct here is one G3-08 calls out as
 * "must survive byte-identical": YAML frontmatter, a GFM table, a fenced code
 * block with a language, a raw HTML block, an HTML comment, footnote syntax,
 * lists, math and an image.
 *
 * The exact string is the assertion target — trailing newline included. If a
 * test fails, the diff helper below prints the first differing byte.
 */
export const KITCHEN_SINK_FIXTURE = `---
title: Kitchen sink
tags:
  - alpha
  - beta
---

# Heading one

Intro paragraph with **bold**, _italic_, \`code\` and a [link](https://example.com).

| col a | col b |
| ----- | ----- |
| 1     | 2     |

\`\`\`ts
const x = 1;

const y = 2;
\`\`\`

<div class="note">
  <p>raw html block</p>
</div>

<!-- keep this comment -->

Footnote reference[^1] here.

[^1]: The footnote body stays literal.

- flat one
- flat two

- outer
    - nested four-space
- outer two

1. ordered one
2. ordered two

- [ ] todo
- [x] done

> quoted text

![alt](assets/pic.png)

Final paragraph.
`;

/** First differing byte plus a little context on each side. */
export function firstByteDifference(actual: string, expected: string): string {
  const limit = Math.max(actual.length, expected.length);
  for (let index = 0; index < limit; index += 1) {
    if (actual[index] !== expected[index]) {
      return [
        `first difference at byte ${index}`,
        `  expected: ${JSON.stringify(expected.slice(Math.max(0, index - 30), index + 40))}`,
        `  actual:   ${JSON.stringify(actual.slice(Math.max(0, index - 30), index + 40))}`,
      ].join("\n");
    }
  }
  return `length differs: expected ${expected.length}, actual ${actual.length}`;
}

function codec() {
  return createMarkdownSourceCodec(createMarkdownEditorExtensions());
}

describe("Markdown source round-trip", () => {
  it("opens and serialises the kitchen-sink fixture byte-identical", () => {
    const source = codec();
    const doc = source.parse(KITCHEN_SINK_FIXTURE);
    const out = source.serialize(doc);
    // Byte-identical means the exact source string: trailing newline, blank
    // lines between blocks, table padding and all.
    expect(out === KITCHEN_SINK_FIXTURE ? "" : firstByteDifference(out, KITCHEN_SINK_FIXTURE)).toBe("");
    expect(out).toBe(KITCHEN_SINK_FIXTURE);
  });

  it("keeps the exact trailing newline and no more", () => {
    const source = codec();
    for (const text of ["Body.", "Body.\n", "Body.\n\n", "Body.\n\n\n"]) {
      expect(source.serialize(source.parse(text))).toBe(text);
    }
  });

  it("changes nothing outside the edited range after one edit", () => {
    const source = codec();
    const doc = source.parse(KITCHEN_SINK_FIXTURE);
    const edited = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const index = (edited.content ?? []).findIndex(
      (node) => node.type === "paragraph" && JSON.stringify(node).includes("Final paragraph"),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const target = edited.content![index] as { attrs?: Record<string, unknown> };
    edited.content![index] = {
      type: "paragraph",
      attrs: target.attrs,
      content: [{ type: "text", text: "Final paragraph edited." }],
    };

    const out = source.serialize(edited);
    // The ONLY byte change is the substitution inside the edited paragraph.
    expect(out).toBe(KITCHEN_SINK_FIXTURE.replace("Final paragraph.", "Final paragraph edited."));
    const head = KITCHEN_SINK_FIXTURE.slice(0, KITCHEN_SINK_FIXTURE.indexOf("Final paragraph."));
    expect(out.slice(0, head.length)).toBe(head);
  });

  it("keeps frontmatter byte-identical even when the body is edited", () => {
    const source = codec();
    const doc = source.parse(KITCHEN_SINK_FIXTURE);
    const edited = JSON.parse(JSON.stringify(doc)) as typeof doc;
    edited.content![1] = { type: "heading", attrs: { level: 1, mdLead: "\n\n" }, content: [{ type: "text", text: "Heading renamed" }] };
    const out = source.serialize(edited);
    expect(out.startsWith("---\ntitle: Kitchen sink\ntags:\n  - alpha\n  - beta\n---\n")).toBe(true);
    expect(out).toContain("# Heading renamed");
  });

  it("round-trips an empty document and a frontmatter-only document", () => {
    const source = codec();
    expect(source.serialize(source.parse(""))).toBe("");
    expect(source.serialize(source.parse("\n"))).toBe("\n");
    const frontmatterOnly = "---\ntitle: Only\n---\n";
    expect(source.serialize(source.parse(frontmatterOnly))).toBe(frontmatterOnly);
  });

  it("does not escape text the document already had (selective escaping)", () => {
    const source = codec();
    for (const text of ["snake_case_name stays", "2 * 3 = 6", "cost is 50% off", "a ~tilde~ b"]) {
      expect(source.serialize(source.parse(text))).toBe(text);
    }
  });

  it("keeps footnote syntax as an opaque raw block instead of escaping it", () => {
    const source = codec();
    const text = "Footnote reference[^1] here.\n";
    const doc = source.parse(text);
    expect(source.serialize(doc)).toBe(text);
  });

  it("reports a table the manager would re-pad as an opaque raw block", () => {
    const source = codec();
    const text = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const doc = toEditorDocument(text, codecManager());
    expect((doc.content ?? []).some((node) => node.type === "markdownRaw")).toBe(true);
    expect(source.serialize(source.parse(text))).toBe(text);
  });
});

/** A manager bound to the same extension set, for the block-level assertions. */
function codecManager() {
  return createMarkdownSourceManager(createMarkdownEditorExtensions());
}

describe("selective escaping", () => {
  it("leaves ordinary text untouched", () => {
    for (const text of [
      "plain sentence",
      "snake_case_name and other_identifiers",
      "2 * 3 = 6",
      "cost is 50% off",
      "a ~tilde~ inside",
      "Footnote reference[^1] here.",
      "[^1]: The footnote body stays literal.",
      "C# and F# are languages",
    ]) {
      expect(escapeSelectiveMarkdownText(text)).toBe(text);
    }
  });

  it("escapes a backslash and a backtick unconditionally", () => {
    expect(escapeSelectiveMarkdownText("back\\slash")).toBe("back\\\\slash");
    expect(escapeSelectiveMarkdownText("a `tick` b")).toBe("a \\`tick\\` b");
  });

  it("escapes emphasis delimiters when a live pair is present", () => {
    expect(escapeSelectiveMarkdownText("2 * 3 and *4*")).toBe("2 \\* 3 and \\*4\\*");
    expect(escapeSelectiveMarkdownText("a _x_ b")).toBe("a \\_x\\_ b");
    expect(escapeSelectiveMarkdownText("a ~~gone~~ b")).toBe("a \\~\\~gone\\~\\~ b");
  });

  it("escapes a bracket only when it opens a link or image label", () => {
    expect(escapeSelectiveMarkdownText("see [docs](https://x) now")).toBe("see \\[docs](https://x) now");
    expect(escapeSelectiveMarkdownText("see [docs] now")).toBe("see [docs] now");
  });

  it("never escapes intraword underscores (CommonMark forbids them)", () => {
    expect(escapeSelectiveMarkdownText("foo_bar_baz")).toBe("foo_bar_baz");
    expect(escapeSelectiveMarkdownText("a _b_ c")).toBe("a \\_b\\_ c");
  });

  it("escapes every escapable character past the scan bound (no quadratic probe)", () => {
    const long = "a_b".repeat(6000);
    const out = escapeSelectiveMarkdownText(long);
    expect(out).toContain("\\_");
    expect(out.length).toBeGreaterThan(long.length);
  });
});
