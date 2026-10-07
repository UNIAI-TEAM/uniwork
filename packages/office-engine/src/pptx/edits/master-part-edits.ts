// Slide master / layout part edits the vendored pptx-ops cannot express
// (UNI-939 T01, B6 acceptance): rename a master/layout, add or remove a
// placeholder, and set a placeholder's text style. They write the part's XML
// in the held archive directly (master-part-xml.ts), the same way
// notes-read.ts planStaleNotesShapeRemoval does: deterministic over the part
// text, so undo/redo (reopen the base + replay the edit journal) reproduce
// them, and savePptx writes the touched entry like any other changed part.
import { PptxEngineError, type OpenedPptxLike, type PptxOpRecord } from "../engine";
import { makePxToEmu } from "../model";
import { listMasterPartInfos } from "./master-edits";
import {
  addPlaceholderXml,
  removePlaceholderXml,
  renamePartXml,
  setTextStyleXml,
  type MasterPlaceholderRef,
  type MasterTextStylePatch,
} from "./master-part-xml";

/** Placeholder types a master/layout part may carry (ECMA-376 ST_PlaceholderType). */
export const MASTER_PLACEHOLDER_TYPES = [
  "title",
  "ctrTitle",
  "subTitle",
  "body",
  "obj",
  "chart",
  "tbl",
  "pic",
  "media",
  "dgm",
  "clipArt",
  "dt",
  "ftr",
  "sldNum",
] as const;
export type MasterPlaceholderType = (typeof MASTER_PLACEHOLDER_TYPES)[number];

/** Part-XML master edits. Every kind addresses a part by path (`part`) and a
 *  placeholder by its slot (`placeholder` type + optional `idx`), never by a
 *  parse-time element id: the slot is stable across the reopen undo runs. */
export type MasterPartEdit =
  | { op: "master_rename"; part: string; name: string }
  | { op: "master_add_placeholder"; part: string; placeholder: MasterPlaceholderType; xPx: number; yPx: number; wPx: number; hPx: number }
  | { op: "master_remove_placeholder"; part: string; placeholder: string; idx?: number }
  | ({ op: "master_set_text_style"; part: string; placeholder: string; idx?: number } & MasterTextStylePatch);

/** What a part edit needs from the session model. */
interface MasterPartModel {
  opened: OpenedPptxLike;
  fitWidthPx: number;
  dirty: boolean;
  revision: number;
  /** The audit trail; a part write records its edit like an applied op. */
  readonly journal: PptxOpRecord[];
}

const refuse = (code: string, op: string, detail: string): never => {
  throw new PptxEngineError(code, op + ": " + detail);
};

const PLACEHOLDER_LABEL: Partial<Record<string, string>> = {
  title: "Title Placeholder",
  ctrTitle: "Title Placeholder",
  subTitle: "Subtitle Placeholder",
  dt: "Date Placeholder",
  ftr: "Footer Placeholder",
  sldNum: "Slide Number Placeholder",
  pic: "Picture Placeholder",
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

function slotOf(edit: { placeholder: string; idx?: number }, op: string): MasterPlaceholderRef {
  if (typeof edit.placeholder !== "string" || edit.placeholder.length === 0) refuse("bad_master_placeholder", op, '"placeholder" must be a placeholder type');
  if (edit.idx !== undefined && (!Number.isInteger(edit.idx) || edit.idx < 0)) refuse("bad_master_placeholder", op, '"idx" must be a non-negative integer');
  return { type: edit.placeholder, ...(edit.idx !== undefined ? { idx: edit.idx } : {}) };
}

function validStyle(edit: MasterTextStylePatch, op: string): MasterTextStylePatch {
  const patch: MasterTextStylePatch = {};
  if (edit.level !== undefined) {
    if (!Number.isInteger(edit.level) || edit.level < 1 || edit.level > 9) refuse("bad_master_style", op, '"level" must be 1..9');
    patch.level = edit.level;
  }
  if (edit.sizePt !== undefined) {
    if (!Number.isFinite(edit.sizePt) || edit.sizePt < 1 || edit.sizePt > 4000) refuse("bad_master_style", op, '"sizePt" must be 1..4000');
    patch.sizePt = edit.sizePt;
  }
  if (edit.bold !== undefined) patch.bold = edit.bold === true;
  if (edit.italic !== undefined) patch.italic = edit.italic === true;
  if (edit.color !== undefined) {
    if (typeof edit.color !== "string" || !HEX.test(edit.color)) refuse("bad_master_style", op, '"color" must be #RRGGBB');
    patch.color = edit.color;
  }
  if (edit.font !== undefined) {
    if (typeof edit.font !== "string" || edit.font.trim().length === 0) refuse("bad_master_style", op, '"font" must be a typeface name');
    patch.font = edit.font.trim();
  }
  const { level: _level, ...changes } = patch;
  if (Object.keys(changes).length === 0) refuse("bad_master_style", op, "set at least one of sizePt, bold, italic, color, font");
  return patch;
}

/** The rewritten part text for one edit; throws before anything is written. */
function rewrite(opened: OpenedPptxLike, fitWidthPx: number, edit: MasterPartEdit, xml: string, kind: "master" | "layout"): string {
  switch (edit.op) {
    case "master_rename": {
      const name = typeof edit.name === "string" ? edit.name.trim() : "";
      if (name.length === 0 || name.length > 255) refuse("bad_master_name", edit.op, '"name" must be 1..255 characters');
      return renamePartXml(xml, name);
    }
    case "master_add_placeholder": {
      if (!(MASTER_PLACEHOLDER_TYPES as readonly string[]).includes(edit.placeholder)) refuse("bad_master_placeholder", edit.op, 'unknown placeholder type "' + String(edit.placeholder) + '"');
      const box = [edit.xPx, edit.yPx, edit.wPx, edit.hPx];
      if (box.some((value) => typeof value !== "number" || !Number.isFinite(value)) || edit.xPx < 0 || edit.yPx < 0 || edit.wPx < 1 || edit.hPx < 1) {
        refuse("bad_master_geometry", edit.op, "x/y must be >= 0 and w/h >= 1 px");
      }
      const toEmu = makePxToEmu(opened, fitWidthPx);
      const label = PLACEHOLDER_LABEL[edit.placeholder] ?? "Content Placeholder";
      return addPlaceholderXml(xml, edit.placeholder, { xEmu: toEmu(edit.xPx), yEmu: toEmu(edit.yPx), cxEmu: Math.max(1, toEmu(edit.wPx)), cyEmu: Math.max(1, toEmu(edit.hPx)) }, label).xml;
    }
    case "master_remove_placeholder":
      return removePlaceholderXml(xml, slotOf(edit, edit.op));
    case "master_set_text_style":
      return setTextStyleXml(xml, kind === "master", slotOf(edit, edit.op), validStyle(edit, edit.op));
    default:
      return refuse("bad_master_edit", String((edit as { op?: unknown }).op), "unknown master part edit");
  }
}

/** Apply one part-XML edit to the held deck: validate, rewrite the part text,
 *  write it back to the archive entry and mark the model changed. */
export function applyMasterPartEdit(model: MasterPartModel, edit: MasterPartEdit): void {
  const info = listMasterPartInfos(model.opened).find((part) => part.partPath === edit.part);
  if (!info) return refuse("bad_master_part", edit.op, 'no master/layout part "' + String(edit.part) + '"');
  const archive = model.opened.archive;
  const xml = archive?.readText?.(info.partPath);
  if (!archive || typeof xml !== "string") return refuse("bad_master_part", edit.op, "part " + info.partPath + " has no text");
  const next = rewrite(model.opened, model.fitWidthPx, edit, xml, info.kind);
  const { op, part, ...fields } = edit;
  // Keep the entry's own representation: the real archive holds bytes, a
  // string-backed archive (tests, tools) keeps text.
  const entries = archive.entries;
  const current = entries instanceof Map ? entries.get(info.partPath) : (entries as Record<string, unknown> | undefined)?.[info.partPath];
  const value = typeof current === "string" ? next : new TextEncoder().encode(next);
  if (entries instanceof Map) entries.set(info.partPath, value);
  else if (entries) (entries as Record<string, unknown>)[info.partPath] = value;
  else refuse("bad_master_part", edit.op, "the archive exposes no writable entries");
  model.journal.push({ op: { op, target: { part }, ...fields } });
  model.dirty = true;
  model.revision += 1;
}
