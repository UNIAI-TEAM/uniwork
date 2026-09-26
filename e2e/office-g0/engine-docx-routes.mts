// DOC-003 engine host: DOCX routes on the real docx engine.
//
// The docs renderer already parses and serializes real bytes in the browser, so
// these routes exist for the engine-side oracle: parse a fixture, rebuild one
// editable paragraph as a generated block, save, then re-parse and prove the new
// text landed while unrelated blocks (table, image, headings) survived. The save
// plan is built from the parsed block list, which is the only legal set
// (parseDocx / saveDocx in packages/docx-engine).
import { basename } from "node:path";
import type { HostContext, RouteMap } from "./engine-host-context.mts";
import { optionalNumber, optionalString, requireString } from "./engine-host-context.mts";
import { DocxEngineError, plainText, type DocxBlock, type DocxParsed } from "./engine-docx.mts";

export function createDocxRoutes(ctx: HostContext) {
  const summaryOf = (parsed: DocxParsed): Record<string, unknown> => ({
    blocks: parsed.blocks.length,
    tables: parsed.blocks.filter((b) => b.type === "table").length,
    images: parsed.blocks.filter((b) => b.type === "image").length,
    headings: parsed.blocks.filter((b) => b.type === "heading").length,
    listItems: parsed.blocks.filter((b) => b.type === "listItem").length,
    passthrough: parsed.blocks.filter((b) => b.type === "passthrough").length,
  });

  const routes: RouteMap = {
    "/engine/docx-parse": async (input) => {
      const docx = await ctx.engines.docx;
      const bytes = await ctx.read(input.path);
      const parsed = await docx.parse(new Uint8Array(bytes));
      return {
        inBytes: bytes.length,
        inHash: ctx.sha256(bytes),
        // `editable` is the paragraph-only oracle set; `visible` is every legal
        // original top-level block (the only set save plans keep as originals).
        editable: docx.editableIndexes(parsed),
        visible: docx.visibleIndexes(parsed),
        ...summaryOf(parsed),
        text: plainText(parsed).slice(0, 8000),
      };
    },

    "/engine/docx-edit": async (input) => {
      // Validate the view id before the docx module loads or a stage dir is made.
      const viewId = ctx.requireViewId(input.viewId);
      const sourcePath = ctx.labFile(input.path);
      const docx = await ctx.engines.docx;
      const bytes = await ctx.read(sourcePath);
      const parsed = await docx.parse(new Uint8Array(bytes));
      // The default target is the first actual editable paragraph, never the first
      // visible block: a leading heading must not be silently demoted. An explicit
      // heading/list/table/image/passthrough target is refused by editParagraph.
      const docxIndex = optionalNumber(input.docxIndex, "docxIndex") ?? docx.editableIndexes(parsed)[0];
      if (docxIndex === undefined) {
        throw new DocxEngineError("no_editable_paragraph", "the document has no visible paragraph to edit");
      }
      const text = requireString(input.text, "text");
      const { plan, replacedIndex } = docx.editParagraph({
        parsed,
        docxIndex,
        text,
        bold: input.bold === true,
      });
      const saved = await docx.save(parsed, plan);
      const name = optionalString(input.name, "name") ?? basename(sourcePath);
      const path = await ctx.stage(viewId, name, saved);
      // Read the bytes actually persisted to the staged file, not the in-memory
      // save result, and re-parse those bytes.
      const persisted = await ctx.read(path);
      const reopened = await docx.parse(new Uint8Array(persisted));
      const textOf = (block: DocxBlock | undefined): string =>
        (block?.runs ?? []).map((run) => run.text ?? "").join("");
      const beforeByIndex = new Map<number, DocxBlock>();
      for (const block of parsed.blocks) if (block.docxIndex !== null) beforeByIndex.set(block.docxIndex, block);
      const afterByIndex = new Map<number, DocxBlock>();
      for (const block of reopened.blocks) if (block.docxIndex !== null) afterByIndex.set(block.docxIndex, block);
      const visible = docx.visibleIndexes(parsed);
      const replaced = afterByIndex.get(replacedIndex);
      const changedNonTarget: number[] = [];
      const missingOriginals: number[] = [];
      for (const index of visible) {
        if (index === replacedIndex) continue;
        const after = afterByIndex.get(index);
        if (after === undefined) {
          missingOriginals.push(index);
          continue;
        }
        const before = beforeByIndex.get(index);
        if (after.type !== before?.type || textOf(after) !== textOf(before)) changedNonTarget.push(index);
      }
      return {
        path,
        replacedIndex,
        inBytes: bytes.length,
        outBytes: saved.length,
        outHash: ctx.sha256(saved),
        persistedBytes: persisted.length,
        persistedHash: ctx.sha256(persisted),
        // Target-specific, read from the persisted bytes: the selected block
        // re-parses as a paragraph whose text is exactly the replacement.
        replacedBlockType: replaced?.type ?? null,
        replacedBlockText: textOf(replaced),
        editPersisted: replaced?.type === "paragraph" && textOf(replaced) === text,
        // Every other legal original block keeps its docxIndex, type and text.
        // Block-count equality is deliberately not reported as preservation.
        originalBlocksChecked: visible.length - 1,
        originalBlocksChanged: changedNonTarget,
        originalBlocksMissing: missingOriginals,
        allOriginalsRetained: changedNonTarget.length === 0 && missingOriginals.length === 0,
        // This route only proves block-level structure after a persisted reopen.
        // Package part bytes (media, styles, relationships) are not verified here
        // and stay with the independent package-byte oracle.
        preservationScope:
          "block-level reparse of persisted staged bytes; package part bytes are not verified by this route",
        ...summaryOf(reopened),
        // The serialized bytes are the renderer''s own output; this route is an
        // engine-side oracle only and is not a browser operation.
        text: plainText(reopened).slice(0, 8000),
      };
    },

    "/engine/docx-unchanged-save": async (input) => {
      const viewId = ctx.requireViewId(input.viewId ?? "docx");
      const sourcePath = ctx.labFile(input.path);
      const docx = await ctx.engines.docx;
      const bytes = await ctx.read(sourcePath);
      const parsed = await docx.parse(new Uint8Array(bytes));
      // Every legal original top-level block, in original order. This is the
      // all-original set, never the paragraph-only editable list.
      const plan = docx.visibleIndexes(parsed).map((docxIndex) => ({ kind: "original" as const, docxIndex }));
      const out = await docx.save(parsed, plan);
      const path = await ctx.stage(viewId, basename(sourcePath), out);
      const persisted = await ctx.read(path);
      return {
        path,
        inBytes: bytes.length,
        outBytes: out.length,
        byteIdentical: Buffer.compare(persisted, bytes) === 0,
        outHash: ctx.sha256(persisted),
        visibleCount: plan.length,
        editableCount: docx.editableIndexes(parsed).length,
      };
    },
  };

  return { routes };
}
