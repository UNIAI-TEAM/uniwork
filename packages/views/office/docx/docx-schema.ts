import { editorExtensions } from "@uniwork/office-upstream/docs-renderer-editor";
import type { Extensions } from "@tiptap/core";
import type { DocxNumberingDef } from "@uniwork/office-engine/docx";

export type DocxBlockKind = "paragraph" | "heading" | "listItem" | "other";

export interface DocxBlockList {
  kind: "bullet" | "ordered";
  numId: string;
  ilvl: number;
}

export interface DocxBlockAttrs {
  docxIndex: number | null;
  originalType: string | null;
  blockKind: DocxBlockKind;
  level: number | null;
  list: DocxBlockList | null;
}

export function docxExtensions(numbering?: ReadonlyMap<string, DocxNumberingDef> | null): Extensions {
  // T-03 (UNI-823 g3-04c): the display-formula surface is read-only for this
  // lane. The vendored DocProtected node view would otherwise wire a hover
  // Edit button that dispatches ai-docs-edit-inline-math, an event no UniWork
  // host consumes; mounting the extension with formulaLatexEdit:false keeps
  // the button and its bridge out of the DOM (the upstream default stays true
  // for the genoffice host — see patches/0003).
  // T-04 (UNI-823 g3-04c): the vendored list numbering storage starts empty and
  // its compute returns early while it is (upstream extensions.ts:2090/2098);
  // upstream's App writes the open document's numbering.xml definitions into
  // that storage. UniWork is the App here, so the seeded definitions ride into
  // `addStorage` at editor creation — every editor gets its own Map.
  return editorExtensions.map((extension) => {
    if (extension.name === "docProtected") return extension.configure({ formulaLatexEdit: false });
    if (extension.name === "listNumbering") {
      const defs = numbering ? new Map(numbering) : new Map<string, DocxNumberingDef>();
      return extension.extend({ addStorage: () => ({ defs: new Map(defs) }) });
    }
    return extension;
  });
}
