import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "./use-docx-tiptap-handle";
import { assertDocxPartsPreserved } from "./test-fixtures/docx-preservation";

const fixtures = ["docx-simple", "docx-kitchen-sink", "docx-vietnamese", "docx-two-columns", "docx-table-image", "docx-long-table", "docx-equation", "docx-pagination-hf"];

const cases = fixtures.flatMap((name) => [1, 2, 3, 4, 5, 6].map((level) => ({ name, level })));

it.each(cases)("preserves heading $level and untouched parts of $name", async ({ name, level }) => {
  const path = name === "docx-pagination-hf" ? "office/docx/test-fixtures/docx-pagination-hf.docx" : `../../docs/office/g0/fixtures/files/docs/${name}.docx`;
  const source = Uint8Array.from(readFileSync(resolve(path)));
  const original = await parseDocx(source);
  const defined = original.headingStyleIds;
  if (!(defined instanceof Map)) throw new Error("fixture_heading_style_metadata_missing");
  const handle = createDocxTiptapHandle({ adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }), documentId: name, readBytes: async () => source });
  try {
    await handle.open();
    expect((await handle.serializeSnapshot(await handle.captureSnapshot())).bytes).toEqual(source);
    handle.commands!.setHeading(level);
    const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect((await parseDocx(saved.bytes)).blocks.some((block) => block.type === "heading" && block.level === level)).toBe(true);
    const fresh = createDocxTiptapHandle({ adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }), documentId: name, readBytes: async () => saved.bytes });
    try { await fresh.open(); expect(fresh.commands!.getState().headingLevel).toBe(level); } finally { await fresh.dispose(); }
    await assertDocxPartsPreserved(source, saved.bytes, !defined.has(level));
  } finally { await handle.dispose(); }
});
