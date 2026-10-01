import type { JSONContent } from "@tiptap/core";
import type { DocxAdapter, DocxBlock, DocxSaveBlock } from "@uniwork/office-engine/docx";
import { pmDocToSavePlan } from "@uniwork/office-upstream/docs-renderer-editor";

export function applyDocxSnapshot(adapter: DocxAdapter, ref: string, doc: JSONContent, originals: DocxBlock[]): void {
  const plan = pmDocToSavePlan(doc, originals);
  if (plan.chartPatches.length) throw new Error("docx_chart_part_edits_unavailable");
  const blocks = plan.saveBlocks as DocxSaveBlock[];
  const anchorAt = new Map([...plan.saveBlockIndexByDocx].map(([docxIndex, position]) => [position, docxIndex]));
  const pristine = adapter.visibleIndexes(ref);
  let pristinePosition = 0;
  const removeUntil = (position: number) => {
    while (pristinePosition < position) {
      adapter.edit(ref, { op: "remove_block", docxIndex: pristine[pristinePosition]! });
      pristinePosition += 1;
    }
  };
  blocks.forEach((block, position) => {
    const anchor = block.kind === "original" ? block.docxIndex : anchorAt.get(position);
    if (anchor !== undefined) {
      const originalPosition = pristine.indexOf(anchor, pristinePosition);
      if (originalPosition < 0) throw new Error("docx_save_anchor_order_invalid");
      removeUntil(originalPosition);
      pristinePosition += 1;
      if (block.kind === "original") return;
      if (block.kind === "xml") {
        adapter.edit(ref, { op: "replace_block_xml", docxIndex: anchor, xml: block.xml, replaceImage: block.replaceImage });
        return;
      }
      adapter.edit(ref, { op: "remove_block", docxIndex: anchor });
    }
    switch (block.kind) {
      case "generated": adapter.edit(ref, { op: "insert_generated", index: position, block: block.block }); break;
      case "xml": adapter.edit(ref, { op: "insert_xml", index: position, xml: block.xml }); break;
      case "image": adapter.edit(ref, { op: "insert_image", index: position, image: block.image }); break;
      case "chart": adapter.edit(ref, { op: "insert_chart", index: position, chart: block.chart, extentPx: block.extentPx }); break;
    }
  });
  removeUntil(pristine.length);
}

export function encodeDocxSource(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function decodeDocxSource(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}
