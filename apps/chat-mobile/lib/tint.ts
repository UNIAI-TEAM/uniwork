// The redesign's tint set (the tint-* tokens) and which one a file card's
// type tile takes: Word blue, Excel green, PDF red, as on the canvas
// (WebMessageKinds, "Tệp Word, Excel").
export type Tint = "blue" | "yellow" | "orange" | "teal" | "green" | "red";

// A Map, not an object: an extension such as "constructor" must not reach the prototype.
const FILE_TINTS = new Map<string, Tint>([
  ["pdf", "red"],
  ["doc", "blue"],
  ["docx", "blue"],
  ["xls", "green"],
  ["xlsx", "green"],
  ["csv", "green"],
  ["ppt", "orange"],
  ["pptx", "orange"],
  ["zip", "yellow"],
  ["rar", "yellow"],
  ["7z", "yellow"],
  ["txt", "teal"],
  ["md", "teal"],
]);

/** A file card's type tile: up to four letters of the extension (empty without one) and its tint. */
export function fileBadge(filename: string): { label: string; tint: Tint } {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return { label: ext.slice(0, 4).toUpperCase(), tint: FILE_TINTS.get(ext) ?? "blue" };
}
