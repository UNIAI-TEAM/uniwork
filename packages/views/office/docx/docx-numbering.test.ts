// T-04 (UNI-823 g3-04c): the list-numbering storage must be initialized with
// the open document's word/numbering.xml definitions. The vendored
// ListNumberingExtension starts from an empty Map and its compute returns
// early while the Map is empty (upstream extensions.ts:2090/2098); upstream's
// App seeds that storage when a document opens, and UniWork now does the same
// through docxExtensions(numbering) at editor creation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter, type DocxBlock, type DocxNumberingDef } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { blocksToDoc } from "./docx-doc-convert";
import { docxExtensions } from "./docx-schema";
import { createDocxTiptapHandle } from "./use-docx-tiptap-handle";

/** The storage slice the mounted schema carries (upstream ListNumberingStorage,
 * extensions.ts:1549) — not declared in the browser-entry shim. */
function listNumberingStorage(editor: Editor): { defs: Map<string, DocxNumberingDef> } {
  return (editor.storage as unknown as { listNumbering: { defs: Map<string, DocxNumberingDef> } }).listNumbering;
}

function markerTexts(editor: Editor): Array<string | null> {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".doc-li")].map((el) => el.getAttribute("data-marker"));
}

const NUMBERED_FIXTURE = resolve(
  __dirname,
  "../../../../docs/office/g0/fixtures/files/docs/docx-numbered-list.docx",
);

describe("DOCX list numbering storage (T-04)", () => {
  it("mounts the definitions it is handed and computes markers from them", () => {
    const defs = new Map<string, DocxNumberingDef>([
      ["7", { numId: "7", abstractNumId: "0", levels: { 0: { numFmt: "decimal", lvlText: "%1.", start: 1 } }, startOverrides: { 0: 4 } }],
    ]);
    const blocks: DocxBlock[] = [
      { type: "listItem", docxIndex: 0, list: { kind: "ordered", numId: "7", ilvl: 0 }, runs: [{ text: "alpha" }] },
      { type: "listItem", docxIndex: 1, list: { kind: "ordered", numId: "7", ilvl: 0 }, runs: [{ text: "omega" }] },
    ];
    const seeded = new Editor({ extensions: docxExtensions(defs), content: blocksToDoc(blocks) });
    try {
      expect(listNumberingStorage(seeded).defs.size).toBe(1);
      // the startOverride (4) can only come from the seeded definition
      expect(markerTexts(seeded)).toEqual(["4.", "5."]);
      expect(seeded.view.dom.querySelector(".doc-li")?.className).toContain("ilvl-0");
    } finally {
      seeded.destroy();
    }

    // The raw renderer default stays empty — hosts that carry no numbering
    // (fake engines, brand-new documents) behave exactly as before.
    const bare = new Editor({ extensions: docxExtensions(), content: blocksToDoc(blocks) });
    try {
      expect(listNumberingStorage(bare).defs.size).toBe(0);
      expect(markerTexts(bare)).toEqual([null, null]);
    } finally {
      bare.destroy();
    }
  });

  it("opens the numbered-list fixture with its real definitions and markers", async () => {
    const adapter = createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) });
    const handle = createDocxTiptapHandle({
      adapter,
      documentId: "doc-numbered-list",
      readBytes: async () => new Uint8Array(readFileSync(NUMBERED_FIXTURE)),
    });
    await handle.open();
    try {
      const defs = adapter.numberingOf(handle.modelRef() as string);
      expect(defs.size).toBe(1);
      expect(defs.get("1")).toMatchObject({
        abstractNumId: "0",
        levels: { 0: { numFmt: "decimal", lvlText: "%1.", indentLeft: 720, hanging: 360 } },
      });

      const surface = handle.renderSurface?.();
      if (surface === null || surface === undefined) throw new Error("docx_surface_missing");
      const view = render(surface as ReactElement);
      const items = [...view.container.querySelectorAll<HTMLElement>(".doc-li")];
      expect(items).toHaveLength(3);
      expect(items.map((el) => el.getAttribute("data-marker"))).toEqual(["1.", "2.", "3."]);
      expect(items.map((el) => el.className)).toEqual([
        "doc-li doc-li-ordered ilvl-0",
        "doc-li doc-li-ordered ilvl-0",
        "doc-li doc-li-ordered ilvl-0",
      ]);
      // the fixture's list paragraphs carry no w:ind of their own, so the
      // level's indent (720/360 twips) is the only geometry source
      expect(items[0]?.style.getPropertyValue("--li-left")).toBe("36pt");
      expect(items[0]?.style.getPropertyValue("--li-hang")).toBe("18pt");
      view.unmount();
    } finally {
      await handle.dispose();
    }
  });
});
