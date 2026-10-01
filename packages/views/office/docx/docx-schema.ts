import { editorExtensions } from "@uniwork/office-upstream/docs-renderer-editor";

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

export function docxExtensions() {
  // T-03 (UNI-823 g3-04c): the display-formula surface is read-only for this
  // lane. The vendored DocProtected node view would otherwise wire a hover
  // Edit button that dispatches ai-docs-edit-inline-math, an event no UniWork
  // host consumes; mounting the extension with formulaLatexEdit:false keeps
  // the button and its bridge out of the DOM (the upstream default stays true
  // for the genoffice host — see patches/0003).
  return editorExtensions.map((extension) =>
    extension.name === "docProtected" ? extension.configure({ formulaLatexEdit: false }) : extension,
  );
}
