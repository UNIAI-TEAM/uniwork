// T-03 (UNI-823 g3-04c): the display-formula surface is read-only for this
// lane. The vendored DocProtected node view wires a hover "Edit" button that
// dispatches ai-docs-edit-inline-math — an event no UniWork host consumes — so
// the UniWork schema mounts DocProtected with formulaLatexEdit:false and the
// wired factory must not create the action.
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { createDocxAdapter, type DocxBlock, type DocxEngineFunctions } from "@uniwork/office-engine/docx";
import { docxExtensions } from "./docx-schema";
import { createDocxTiptapHandle } from "./use-docx-tiptap-handle";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/** Deterministic fake engine: bytes are JSON {blocks}; the real vendored
 * renderer still builds the DOM from the parsed blocks. */
function fakeEngine(): DocxEngineFunctions {
  return {
    async parseDocx(bytes) {
      const { blocks } = JSON.parse(decoder.decode(bytes.subarray(ZIP_MAGIC.length))) as { blocks: Array<Record<string, unknown>> };
      const withIndex = blocks.map((block, index) => ({ ...block, type: String(block.type), docxIndex: index }) as DocxBlock);
      return { blocks: withIndex };
    },
    async saveDocx() {
      throw new Error("equation read-only test never saves");
    },
  };
}

function fixtureBytes(blocks: Array<Record<string, unknown>>): Uint8Array {
  const payload = encoder.encode(JSON.stringify({ blocks }));
  const bytes = new Uint8Array(ZIP_MAGIC.length + payload.length);
  bytes.set(ZIP_MAGIC);
  bytes.set(payload, ZIP_MAGIC.length);
  return bytes;
}

/** A display equation exactly as the real parse emits it: the wire reads
 * formulaDisplay.latex on a docProtected node, and tokens.length > 0 selects
 * the formula DOM. */
const EQUATION_BLOCK = {
  type: "equation",
  label: "Equation",
  formulaDisplay: {
    tokens: ["x", "=", "1"],
    mathml: "<math><mi>x</mi><mo>=</mo><mn>1</mn></math>",
    latex: "x=1",
  },
};

describe("DOCX equation surface (read-only lane)", () => {
  it("renders the formula while exposing no enabled edit action", async () => {
    const adapter = createDocxAdapter({ engine: fakeEngine() });
    const handle = createDocxTiptapHandle({ adapter, documentId: "doc-eq", readBytes: async () => fixtureBytes([EQUATION_BLOCK]) });
    await handle.open();
    try {
      const mounted = docxExtensions().find((extension) => extension.name === "docProtected");
      expect(mounted?.options).toMatchObject({ formulaLatexEdit: false });

      const view = render(handle.renderSurface() as ReactElement);
      // The equation really rendered: the MathML host holds the parsed markup.
      expect(view.container.querySelector(".doc-formula-math")?.innerHTML).toContain("<math");
      // ... and the equation surface carries no enabled Edit affordance.
      const edit = view.container.querySelector<HTMLButtonElement>(".doc-formula-edit");
      expect(edit === null || edit.disabled || edit.getAttribute("aria-disabled") === "true").toBe(true);
      view.unmount();
    } finally {
      await handle.dispose();
    }
  });
});
