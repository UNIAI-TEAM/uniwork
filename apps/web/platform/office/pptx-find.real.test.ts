/** @vitest-environment node */
// UNI-927 X4 (R2-6) - the find panel's match unit on the REAL vendored engine.
// `flattenDeckRuns` reads the opened deck model structurally, so a fake deck could hide a
// wrong shape (table cells, group children, field runs). This opens the real fixtures,
// counts the hits the panel would show, runs the real `find_replace` edit through the web
// runtime and proves the number replaced is the number counted.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx } from "@uniwork/office-upstream/pptx-renderer";
import { planFindReplace } from "@uniwork/office-engine/pptx";
import { flattenDeckRuns } from "@uniwork/views/office/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

// vitest runs with cwd = apps/web.
const FIXTURES = resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides");
const bytes = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const REPLACEMENT = "\u00A7X4\u00A7";
const occurrences = (texts: readonly string[], needle: string) => texts.reduce((sum, text) => sum + text.split(needle).length - 1, 0);

async function open(name: string) {
  const runtime = createWebPptxSessionRuntime({ documentId: name });
  const result = await runtime.open({ bytes: bytes(name), documentId: name });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error(name + " did not open: " + String(result.message));
  return { runtime, ref: result.document_model_ref };
}

/** A query that really occurs: the longest word of the first run that has one. */
function pickQuery(texts: readonly string[]): string {
  for (const text of texts) {
    const word = text.split(/\s+/).filter((candidate) => candidate.length >= 3).sort((a, b) => b.length - a.length)[0];
    if (word) return word;
  }
  throw new Error("fixture has no searchable run");
}

describe.each(["pptx-standard-business.pptx", "pptx-vietnamese.pptx", "pptx-table.pptx"])("find over the real deck: %s", (name) => {
  it("flattens the deck into runs and counts what the real find_replace edit replaces", async () => {
    const { runtime, ref } = await open(name);
    const runs = flattenDeckRuns(runtime.deck(ref));
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.text).not.toBe("");
      expect(run.slideIndex).toBeGreaterThanOrEqual(0);
      expect(run.elementId).toBeTypeOf("string");
    }
    const query = pickQuery(runs.map((run) => run.text));
    const plan = planFindReplace(runs.map((run) => run.text), query, { matchCase: true });
    expect(plan.total).toBeGreaterThan(0);

    await runtime.edit(ref, [{ op: "find_replace", find: query, replace: REPLACEMENT, matchCase: true }]);

    const after = flattenDeckRuns(runtime.deck(ref)).map((run) => run.text);
    expect(occurrences(after, REPLACEMENT)).toBe(plan.total);
    expect(occurrences(after, query)).toBe(0);
  });

  it("replace-one scoped to the hit's element changes only that element", async () => {
    const { runtime, ref } = await open(name);
    const runs = flattenDeckRuns(runtime.deck(ref));
    const query = pickQuery(runs.map((run) => run.text));
    const before = planFindReplace(runs.map((run) => run.text), query, { matchCase: true });
    const hit = runs[before.hits[0]!.index - 1]!;

    await runtime.edit(ref, [{ op: "find_replace", find: query, replace: REPLACEMENT, matchCase: true, firstOnly: true, slideIndex: hit.slideIndex, elementId: hit.elementId! }]);

    const after = flattenDeckRuns(runtime.deck(ref)).map((run) => run.text);
    expect(occurrences(after, REPLACEMENT)).toBe(1);
    expect(planFindReplace(after, query, { matchCase: true }).total).toBe(before.total - 1);
  });
});

describe("find over the real deck: table cells", () => {
  it("reaches the runs inside table cells, scoped to the table's element id", async () => {
    const { runtime, ref } = await open("pptx-table.pptx");
    const deck = runtime.deck(ref) as { slides: Array<{ elements: Array<{ id: string; type: string }> }> };
    const tableIds = new Set(deck.slides.flatMap((slide) => slide.elements.filter((element) => element.type === "table").map((element) => element.id)));
    expect(tableIds.size).toBeGreaterThan(0);
    const cellRuns = flattenDeckRuns(deck).filter((run) => run.elementId && tableIds.has(run.elementId));
    expect(cellRuns.length).toBeGreaterThan(0);
  });
});

// X4fix F3: Replace (one) replaces the SHOWN hit. The vendored op alone always spends its
// budget on the element's first match; the hit ordinal (`occurrence`) must reach the second.
describe("replace-one on the real deck: the second match of one element", () => {
  const MARK = "§";
  const textOf = (deck: unknown, slideIndex: number, elementId: string) =>
    flattenDeckRuns(deck).filter((run) => run.slideIndex === slideIndex && run.elementId === elementId).map((run) => run.text).join(MARK);
  // The real engine re-mints element ids on every reopen (undo/redo replay), so the
  // element is followed by its position on the slide.
  const elementIds = (deck: unknown, slideIndex: number) =>
    (deck as { slides: Array<{ elements: Array<{ id: string }> }> }).slides[slideIndex]!.elements.map((element) => element.id);
  const textAt = (deck: unknown, slideIndex: number, position: number) => textOf(deck, slideIndex, elementIds(deck, slideIndex)[position]!);

  it("replaces only the second match, survives save + reopen, and undoes/redoes as one step", async () => {
    const { runtime, ref } = await open("pptx-standard-business.pptx");
    const runs = flattenDeckRuns(runtime.deck(ref));
    // The first element (and letter) with at least two case-sensitive matches.
    let pick: { slideIndex: number; elementId: string; query: string } | null = null;
    for (const query of ["e", "a", "o", "t"]) {
      for (const run of runs) {
        const text = textOf(runtime.deck(ref), run.slideIndex, run.elementId!);
        if (text.split(query).length - 1 >= 2) { pick = { slideIndex: run.slideIndex, elementId: run.elementId!, query }; break; }
      }
      if (pick) break;
    }
    if (!pick) throw new Error("fixture has no element with two matches");
    const position = elementIds(runtime.deck(ref), pick.slideIndex).indexOf(pick.elementId);
    const before = textOf(runtime.deck(ref), pick.slideIndex, pick.elementId);
    const first = before.indexOf(pick.query);
    const second = before.indexOf(pick.query, first + pick.query.length);
    const expected = before.slice(0, second) + REPLACEMENT + before.slice(second + pick.query.length);

    await runtime.edit(ref, [{ op: "find_replace", find: pick.query, replace: REPLACEMENT, matchCase: true, firstOnly: true, slideIndex: pick.slideIndex, elementId: pick.elementId, occurrence: 1 }]);
    expect(textAt(runtime.deck(ref), pick.slideIndex, position)).toBe(expected);
    // No private-use marker survives anywhere in the deck.
    expect(flattenDeckRuns(runtime.deck(ref)).some((run) => /[-]/.test(run.text))).toBe(false);

    // Undo is the journal replay: one step back to the original text, one step forward again.
    expect(await runtime.undo(ref)).toBe(true);
    expect(textAt(runtime.deck(ref), pick.slideIndex, position)).toBe(before);
    expect(await runtime.redo(ref)).toBe(true);
    expect(textAt(runtime.deck(ref), pick.slideIndex, position)).toBe(expected);

    // Save and reopen the bytes independently: the saved file holds exactly that edit.
    const value = runtime.snapshot(ref);
    const out = await runtime.serialize(ref, { snapshot: { generation: 1, fingerprint: "fp", value } });
    const reopened = await openPptx(out.bytes);
    const saved = flattenDeckRuns(reopened.deck).filter((run) => run.slideIndex === pick.slideIndex).map((run) => run.text).join(MARK);
    expect(saved).toContain(expected);
  });
});
