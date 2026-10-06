/** @vitest-environment node */
// UNI-939 T02/T03 - connector line style and explicit attach sides on the REAL vendored engine
// (nothing mocked): the sides pin stCxn/endCxn to the picked sites and the connector frame to those
// edge midpoints, the line style lands in a:ln, set_stroke restyles it, and all of it survives
// undo, redo, save and reopen. Fake engines cannot prove any of this.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openPptx } from "@uniwork/office-upstream/pptx-renderer";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
import { createWebPptxSessionRuntime } from "./pptx-runtime";

const fixture = () => new Uint8Array(readFileSync(resolve(process.cwd(), "../../docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx")));

interface RealElement {
  id: string;
  stroke?: { fill?: { color?: string }; width?: number; dash?: string };
  transform: { offset: { x: number; y: number; cx: number; cy: number } };
}
type Runtime = ReturnType<typeof createWebPptxSessionRuntime>;

const elementsOf = (deck: unknown): RealElement[] => (deck as { slides: Array<{ elements: RealElement[] }> }).slides[0]?.elements ?? [];
const xmlOf = (element: RealElement | undefined): string =>
  String((element as unknown as { anchor?: { originalXml?: string } } | undefined)?.anchor?.originalXml ?? "");

async function openWithTwoBoxes(id: string) {
  const runtime = createWebPptxSessionRuntime({ documentId: id });
  const result = await runtime.open({ bytes: fixture(), documentId: id });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + String(result.message));
  const ref = result.document_model_ref;
  const rect = (xPx: number, yPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx, wPx: 80, hPx: 50 });
  const a = (await runtime.edit(ref, [rect(40, 100)])).createdIds?.[0];
  const b = (await runtime.edit(ref, [rect(400, 300)])).createdIds?.[0];
  if (!a || !b) throw new Error("boxes were not created");
  return { runtime, ref, a, b };
}

const saveBytes = async (runtime: Runtime, ref: string): Promise<Uint8Array> => {
  const value = runtime.snapshot(ref);
  return (await runtime.serialize(ref, { snapshot: { generation: value.revision, fingerprint: "fp", value } })).bytes;
};

const strokeOf = (element: RealElement | undefined) => ({ color: element?.stroke?.fill?.color, width: element?.stroke?.width, dash: element?.stroke?.dash });
const findById = (runtime: Runtime, ref: string, id: string) => elementsOf(runtime.deck(ref)).find((element) => element.id === id);

describe("PPTX connector sides and line style on the real engine (UNI-939)", () => {
  it("pins each end to the picked side, writes the line, restyles it, and survives undo, redo, save and reopen", async () => {
    const { runtime, ref, a, b } = await openWithTwoBoxes("real-connector-sides");
    const line = { color: "#C00000", widthEmu: 38100, dash: "dash" };
    const created = (await runtime.edit(ref, [{ op: "add_connector", slideIndex: 0, elementIds: [a, b], kind: "straight", arrow: "end", fromSide: "bottom", toSide: "top", line }])).createdIds?.[0];
    expect(created).toBeTruthy();

    const connector = findById(runtime, ref, created!);
    const xml = xmlOf(connector);
    // rect connection sites: top 0, left 1, bottom 2, right 3.
    expect(xml).toMatch(/<a:stCxn id="\d+" idx="2"\/>/);
    expect(xml).toMatch(/<a:endCxn id="\d+" idx="0"\/>/);
    expect(xml).toContain('w="38100"');
    expect(xml).toContain("C00000");
    expect(xml).toContain('<a:prstDash val="dash"');

    // The frame runs from the bottom midpoint of A to the top midpoint of B (what the canvas draws).
    const boxA = findById(runtime, ref, a)!.transform.offset;
    const boxB = findById(runtime, ref, b)!.transform.offset;
    const frame = connector!.transform.offset;
    expect(frame.y).toBe(boxA.y + boxA.cy);
    expect(frame.y + frame.cy).toBe(boxB.y);
    expect(frame.x).toBe(boxA.x + Math.round(boxA.cx / 2));

    // set_stroke restyles the existing connector (a shape element for the engine).
    await runtime.edit(ref, [{ op: "set_stroke", slideIndex: 0, elementId: created!, stroke: { color: "#00AA00", widthEmu: 25400, dash: "sysDot" } }]);
    // The live model carries the new stroke; originalXml is only rewritten on save.
    expect(strokeOf(findById(runtime, ref, created!))).toEqual({ color: "#00AA00", width: 25400, dash: "sysDot" });
    expect(xmlOf(findById(runtime, ref, created!))).toMatch(/<a:stCxn id="\d+" idx="2"\/>/);

    // Undo the restyle, then the connector; redo brings both back.
    expect(await runtime.undo(ref)).toBe(true);
    // Replay re-mints ids, so the connector is read as the last element; a reopened element carries its fresh XML.
    const undone = xmlOf(elementsOf(runtime.deck(ref)).at(-1));
    expect(undone).toContain('w="38100"');
    expect(undone).toContain('<a:prstDash val="dash"');
    expect(await runtime.undo(ref)).toBe(true);
    expect(elementsOf(runtime.deck(ref)).some((element) => xmlOf(element).includes("<p:cxnSp"))).toBe(false);
    expect(await runtime.redo(ref)).toBe(true);
    expect(await runtime.redo(ref)).toBe(true);

    const saved = elementsOf((await openPptx(await saveBytes(runtime, ref))).deck);
    const savedXml = xmlOf(saved.find((element) => xmlOf(element).includes("<p:cxnSp")));
    expect(savedXml).toMatch(/<a:stCxn id="\d+" idx="2"\/>/);
    expect(savedXml).toMatch(/<a:endCxn id="\d+" idx="0"\/>/);
    expect(savedXml).toContain('w="25400"');
    expect(savedXml).toContain("00AA00");
    expect(savedXml).toContain('<a:prstDash val="sysDot"');
    await runtime.release(ref);
  }, 90_000);

  it("keeps the engine's closest-side pick and 1pt black stroke when no side or line is sent", async () => {
    const { runtime, ref, a, b } = await openWithTwoBoxes("real-connector-auto");
    const created = (await runtime.edit(ref, [{ op: "add_connector", slideIndex: 0, elementIds: [a, b], kind: "straight" }])).createdIds?.[0];
    const xml = xmlOf(findById(runtime, ref, created!));
    expect(xml).toMatch(/<a:stCxn id="\d+" idx="\d"\/>/);
    expect(xml).toMatch(/<a:endCxn id="\d+" idx="\d"\/>/);
    expect(xml).toContain('w="12700"');
    expect(xml).not.toContain("prstDash");
    await runtime.release(ref);
  }, 60_000);

  it("pins only the given end and leaves the other to the closest-pair pick", async () => {
    const { runtime, ref, a, b } = await openWithTwoBoxes("real-connector-one-side");
    const created = (await runtime.edit(ref, [{ op: "add_connector", slideIndex: 0, elementIds: [a, b], kind: "elbow", toSide: "left" }])).createdIds?.[0];
    const xml = xmlOf(findById(runtime, ref, created!));
    expect(xml).toMatch(/<a:endCxn id="\d+" idx="1"\/>/);
    expect(xml).toMatch(/<a:stCxn id="\d+" idx="\d"\/>/);
    await runtime.release(ref);
  }, 60_000);
});
