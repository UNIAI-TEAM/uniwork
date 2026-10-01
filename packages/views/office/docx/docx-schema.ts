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
  return [...editorExtensions];
}
