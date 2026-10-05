/** @vitest-environment node */
// UNI-927 X3 (R2-5): applying a theme on the REAL vendored engine keeps every
// explicit srgbClr (shape fill / outline, text runs, table cells) and only
// moves theme-mapped state. Nothing is mocked: the generated pptx-renderer
// artifact is patched by 0007-pptx-apply-theme-keeps-explicit-colors.patch;
// without that patch the vendored applyTheme remaps explicit colours to the
// nearest theme accent and these assertions fail.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindPptxEngine, bindPptxOps, createPptxAdapter, type PptxEdit } from "@uniwork/office-engine/pptx";
import { commitSaved, openPptx, reparseDeck, runTxn, savePptx } from "@uniwork/office-upstream/pptx-renderer";

const slidesDir = resolve(__dirname, "../../../../../docs/office/g0/fixtures/files/slides");
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(slidesDir, name)));

// "Rung xanh": accent1 1E7A46 plus greens - none of them an explicit colour a
// user would pick, so a remap is easy to see.
const GREEN_THEME: PptxEdit = {
  op: "apply_theme",
  name: "Rung xanh",
  colors: {
    dk1: "14281C", lt1: "F4FBF5", dk2: "22402C", lt2: "DDEFE0",
    accent1: "1E7A46", accent2: "5DC837", accent3: "259957", accent4: "9BD36B", accent5: "2F5D3A", accent6: "B5E3A0",
    hlink: "1E7A46", folHlink: "5DC837",
  },
};

const newAdapter = () =>
  createPptxAdapter({
    engine: bindPptxEngine({ openPptx, savePptx, commitSaved, reparseDeck }),
    ops: bindPptxOps({ runTxn }),
  });

async function open(adapter: ReturnType<typeof newAdapter>, name: string): Promise<string> {
  const result = await adapter.open({ bytes: bytesOf(name), format: "pptx", document_id: name });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("fixture did not open: " + name);
  return result.document_model_ref;
}

async function slideXmls(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    out[name] = await zip.files[name]!.async("string");
  }
  return out;
}

const srgbValues = (xml: string): string[] => [...xml.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase());
const count = (values: string[]): Map<string, number> => values.reduce((map, v) => map.set(v, (map.get(v) ?? 0) + 1), new Map<string, number>());

describe("apply_theme keeps explicit colours on the real engine (R2-5)", () => {
  it("an inserted rectangle keeps its explicit fill and outline through apply_theme, save and reopen", async () => {
    const adapter = newAdapter();
    const ref = await open(adapter, "pptx-standard-business.pptx");
    const created = adapter.edit(ref, { op: "add_element", slideIndex: 0, kind: "rect", xPx: 40, yPx: 40, wPx: 120, hPx: 60 }).createdId;
    expect(created).toBeTruthy();
    adapter.edit(ref, { op: "set_fill", slideIndex: 0, elementId: created!, fill: "#FF0000" });
    adapter.edit(ref, { op: "set_stroke", slideIndex: 0, elementId: created!, stroke: { color: "#0000FF", widthEmu: 12700 } });
    adapter.edit(ref, GREEN_THEME);

    const saved = (await adapter.serialize({ document_model_ref: ref, format: "pptx" })).bytes;
    const slide1 = (await slideXmls(saved))["ppt/slides/slide1.xml"]!;
    const values = srgbValues(slide1);
    expect(values).toContain("FF0000");
    expect(values).toContain("0000FF");
    for (const remapped of ["5DC837", "259957"]) expect(values).not.toContain(remapped);

    // The theme itself did change: accent1 is the preset's, in the saved theme part.
    const zip = await JSZip.loadAsync(saved);
    const theme = await zip.files["ppt/theme/theme1.xml"]!.async("string");
    expect(theme).toMatch(/<a:accent1>\s*<a:srgbClr val="1E7A46"/i);
    expect(theme).toContain('name="Rung xanh"');
  }, 60_000);

  // Every row seeds explicit colours first: three of the four G0 decks carry no
  // srgbClr in their slide XML, so comparing only the source deck proved nothing.
  // A table fixture also gets explicit cell shading, the table-cell fill risk
  // area (those fills live in slide XML and were remapped before patch 0007).
  it.each([
    { name: "pptx-standard-business.pptx", table: false },
    { name: "pptx-table.pptx", table: true },
    { name: "pptx-chart.pptx", table: false },
    { name: "pptx-vietnamese.pptx", table: false },
  ])(
    "$name: explicit srgbClr (source and seeded) survive apply_theme",
    async ({ name, table }) => {
      const adapter = newAdapter();
      const ref = await open(adapter, name);
      const created = adapter.edit(ref, { op: "add_element", slideIndex: 0, kind: "rect", xPx: 40, yPx: 40, wPx: 120, hPx: 60 }).createdId;
      adapter.edit(ref, { op: "set_fill", slideIndex: 0, elementId: created!, fill: "#FF0000" });
      adapter.edit(ref, { op: "set_stroke", slideIndex: 0, elementId: created!, stroke: { color: "#0000FF", widthEmu: 12700 } });
      if (table) {
        const tableId = adapter.sessionOf(ref).model.opened.deck.slides[0]!.elements.find((el) => el.type === "table")?.id;
        expect(tableId, "pptx-table.pptx slide 1 has a table").toBeTruthy();
        adapter.edit(ref, { op: "set_table_style", slideIndex: 0, elementId: tableId!, shadingColor: "#C0FFEE" });
      }
      const save = async () => slideXmls((await adapter.serialize({ document_model_ref: ref, format: "pptx" })).bytes);
      const before = await save();
      const seeded = count(Object.values(before).flatMap(srgbValues));
      // The seeding itself landed (a vacuous row would have nothing to protect).
      expect(seeded.get("FF0000") ?? 0).toBeGreaterThanOrEqual(1);
      expect(seeded.get("0000FF") ?? 0).toBeGreaterThanOrEqual(1);
      if (table) expect(seeded.get("C0FFEE") ?? 0).toBeGreaterThanOrEqual(1);

      adapter.edit(ref, GREEN_THEME);
      const after = count(Object.values(await save()).flatMap(srgbValues));
      for (const [value, n] of seeded) expect(after.get(value) ?? 0, `${name} ${value}`).toBeGreaterThanOrEqual(n);
    },
    60_000,
  );
});
