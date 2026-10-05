/** @vitest-environment node */
// UNI-927 W12 (W11 review F1) - the web runtime on the REAL vendored engine
// (nothing mocked: @uniwork/office-upstream/pptx-renderer is the generated
// artifact). The real engine re-mints every parsed id on each open and every
// inserted id on each apply, which the fake engines never did; this proves
// insert -> format(created id) and format(parsed element) survive the
// reopen-and-replay that undo, redo and save run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx } from "@uniwork/office-upstream/pptx-renderer";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

// vitest runs with cwd = apps/web.
const fixture = () => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx")));

interface RealElement {
  id: string;
  type: string;
  text?: { anchor?: string };
}

const elementsOf = (deck: unknown, slideIndex = 0): RealElement[] =>
  ((deck as { slides: Array<{ elements: RealElement[] }> }).slides[slideIndex]?.elements ?? []);

describe("web PPTX runtime on the real engine - replay-stable ids (W12)", () => {
  it("replays insert -> format(created) and format(parsed) through undo, redo, save and reopen", async () => {
    const runtime = createWebPptxSessionRuntime({ documentId: "real" });
    const result = await runtime.open({ bytes: fixture(), documentId: "real" });
    if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
    const ref = result.document_model_ref;
    const baseCount = elementsOf(runtime.deck(ref)).length;
    const parsed = elementsOf(runtime.deck(ref)).find((element) => element.type === "text" || element.type === "shape");
    if (!parsed) throw new Error("fixture slide 1 has no text/shape element");
    const parsedIndex = elementsOf(runtime.deck(ref)).indexOf(parsed);

    const insert: PptxEdit = { op: "add_element", slideIndex: 0, kind: "rect", xPx: 40, yPx: 40, wPx: 120, hPx: 60 };
    const created = (await runtime.edit(ref, [insert])).createdIds?.[0];
    expect(created).toBeTruthy();
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: created!, anchor: "middle" }]);
    await runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: parsed.id, anchor: "bottom" }]);
    // A trailing non-element step, so the first undo replays all three above.
    // (The real slide model exposes no hidden flag, so only the step count is asserted.)
    await runtime.edit(ref, [{ op: "set_slide_hidden", slideIndex: 1, hidden: true }]);

    // Undo = reopen the base (every parsed id re-minted) + replay three
    // element-targeted entries; before W12 the first one missed.
    expect(await runtime.undo(ref)).toBe(true);
    const live = elementsOf(runtime.deck(ref));
    expect(live).toHaveLength(baseCount + 1);
    expect(live[parsedIndex]?.id).not.toBe(parsed.id);
    expect(live[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(live.at(-1)?.id).not.toBe(created);
    expect(live.at(-1)?.text?.anchor).toBe("middle");

    // Two more undos (replays of [insert, format] and [insert]), then redo both.
    expect(await runtime.undo(ref)).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(elementsOf(runtime.deck(ref)).at(-1)?.text?.anchor).not.toBe("middle");
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);

    // Save the tip and reopen the bytes independently: the formats landed.
    const value = runtime.snapshot(ref);
    expect(value.revision).toBe(4);
    const out = await runtime.serialize(ref, { snapshot: { generation: 4, fingerprint: "fp", value } });
    const reopened = await openPptx(out.bytes);
    const saved = elementsOf(reopened.deck);
    expect(saved).toHaveLength(baseCount + 1);
    expect(saved[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(saved.at(-1)?.text?.anchor).toBe("middle");

    // The recovered-draft path: a fresh runtime (its own reopened ids) replays
    // the snapshot journal onto the base bytes.
    const fresh = createWebPptxSessionRuntime({ documentId: "real" });
    const second = await fresh.open({ bytes: fixture(), documentId: "real" });
    if (second.outcome !== "opened" || !second.document_model_ref) throw new Error("second open failed");
    await fresh.restore!(second.document_model_ref, JSON.parse(JSON.stringify(value)) as typeof value);
    const restored = elementsOf(fresh.deck(second.document_model_ref));
    expect(restored[parsedIndex]?.text?.anchor).toBe("bottom");
    expect(restored.at(-1)?.text?.anchor).toBe("middle");
    await runtime.release(ref);
    await fresh.release(second.document_model_ref);
  }, 60_000);
});
