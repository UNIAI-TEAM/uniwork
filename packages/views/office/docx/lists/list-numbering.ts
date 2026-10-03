// B5 (UNI-924): the multilevel-list model shared by the numbering command
// area and the toolbar menus. It owns the authored list definitions (bullet
// library / numbering library / multilevel library), numId allocation above
// the open document's definitions plus this session's pending edits, and the
// overlay definitions the editor's list-numbering storage renders markers
// from before the save writes the part.
import type { Editor } from "@tiptap/core";
import type {
  DocxNewNumberingDef,
  DocxNumberingDef,
  DocxNumberingLevel,
  DocxNumberingLevelSpec,
  DocxRestartNumbering,
} from "@uniwork/office-engine/docx";

export type DocxListKind = "bullet" | "ordered";

/** The pending numbering-part edits a save must carry (the snapshot shape). */
export interface DocxNumberingSnapshot {
  newDefs: DocxNewNumberingDef[];
  restartNums: DocxRestartNumbering[];
}

/** One level of the caret's definition, as the level picker reads it. */
export interface DocxListLevelInfo {
  ilvl: number;
  numFmt: string;
  lvlText: string;
}

/** The caret's list context: the item's own numbering plus the definition's
 * levels (empty when the document carries no definition for it). */
export interface DocxListState {
  kind: DocxListKind;
  numId: string;
  ilvl: number;
  levels: DocxListLevelInfo[];
}

export type DocxListPresetGroup = "bullets" | "numbers" | "multilevel";

export type DocxBulletGlyph = "dot" | "circle" | "square" | "diamond" | "arrow" | "star";

export type DocxNumberStyle = "decimal-dot" | "decimal-paren" | "roman-dot" | "upper-letter-dot" | "lower-letter-paren" | "han-comma";

export type DocxMultilevelStyle = "decimal" | "chinese" | "bullet";

/** Every gallery entry: `<group>-<style>` (the id is the i18n-free identity). */
export type DocxListPresetId =
  | `bullet-${DocxBulletGlyph}`
  | `number-${DocxNumberStyle}`
  | `multilevel-${DocxMultilevelStyle}`;

export interface DocxListPreset {
  id: DocxListPresetId;
  group: DocxListPresetGroup;
  kind: DocxListKind;
  /** Nine levels (ilvl 0-8), like Word's list galleries. */
  levels: DocxNumberingLevelSpec[];
  /** The level-1 marker text, as the gallery previews it. */
  sample: string;
  /** The preview's deeper levels, joined with spaces (multilevel presets). */
  sampleChain: string;
}

/** Word clamps list levels to nine (w:ilvl 0..8). */
export const DOCX_LIST_MAX_LEVEL = 8;

const BULLET_GLYPHS: Record<DocxBulletGlyph, string> = {
  dot: "•",
  circle: "○",
  square: "■",
  diamond: "◆",
  arrow: "➢",
  star: "✦",
};

interface NumberStyleSpec {
  numFmt: string;
  pattern: string;
  sample: string;
}

const NUMBER_STYLES: Record<DocxNumberStyle, NumberStyleSpec> = {
  "decimal-dot": { numFmt: "decimal", pattern: "%1.", sample: "1." },
  "decimal-paren": { numFmt: "decimal", pattern: "%1)", sample: "1)" },
  "roman-dot": { numFmt: "upperRoman", pattern: "%1.", sample: "I." },
  "upper-letter-dot": { numFmt: "upperLetter", pattern: "%1.", sample: "A." },
  "lower-letter-paren": { numFmt: "lowerLetter", pattern: "%1)", sample: "a)" },
  "han-comma": { numFmt: "chineseCountingThousand", pattern: "%1、", sample: "一、" },
};

/** The bullet library rotates the chosen glyph through the standard trio
 * (genoffice Ribbon.tsx:521 `bulletPresetLevels`). */
function bulletLevels(glyph: string): DocxNumberingLevelSpec[] {
  const rotation = [glyph, BULLET_GLYPHS.circle, BULLET_GLYPHS.square];
  return Array.from({ length: 9 }, (_, ilvl) => ({
    numFmt: "bullet",
    lvlText: rotation[ilvl % 3] as string,
    indentLeft: 720 * (ilvl + 1),
    hanging: 360,
  }));
}

/** The numbering library continues the same format per level (`%1` becomes the
 * level's own counter; genoffice Ribbon.tsx:532). */
function numberLevels(spec: NumberStyleSpec): DocxNumberingLevelSpec[] {
  return Array.from({ length: 9 }, (_, ilvl) => ({
    numFmt: spec.numFmt,
    lvlText: spec.pattern.replace("%1", `%${ilvl + 1}`),
    indentLeft: 720 * (ilvl + 1),
    hanging: 360,
  }));
}

/** 1. / 1.1. / 1.1.1. (genoffice MULTILEVEL_LIBRARY[0]). */
function decimalChainLevels(): DocxNumberingLevelSpec[] {
  return Array.from({ length: 9 }, (_, ilvl) => ({
    numFmt: "decimal",
    lvlText: `${Array.from({ length: ilvl + 1 }, (_, depth) => `%${depth + 1}`).join(".")}.`,
    indentLeft: 720 * (ilvl + 1),
    hanging: 432,
  }));
}

/** Chinese official-document hierarchy: 一、 / (一) / 1. (genoffice
 * MULTILEVEL_LIBRARY[1]). */
function chineseChainLevels(): DocxNumberingLevelSpec[] {
  return Array.from({ length: 9 }, (_, ilvl) => {
    if (ilvl === 0) return { numFmt: "chineseCountingThousand", lvlText: "%1、", indentLeft: 720, hanging: 425 };
    if (ilvl === 1) return { numFmt: "chineseCountingThousand", lvlText: "(%2)", indentLeft: 1440, hanging: 425 };
    return { numFmt: "decimal", lvlText: `%${ilvl + 1}.`, indentLeft: 720 * (ilvl + 1), hanging: 360 };
  });
}

function preset(
  id: DocxListPresetId,
  group: DocxListPresetGroup,
  kind: DocxListKind,
  levels: DocxNumberingLevelSpec[],
  sample: string,
  sampleChain: string,
): DocxListPreset {
  return { id, group, kind, levels, sample, sampleChain };
}

const BULLET_PRESETS: DocxListPreset[] = (Object.keys(BULLET_GLYPHS) as DocxBulletGlyph[]).map((glyphName) =>
  preset(
    `bullet-${glyphName}`,
    "bullets",
    "bullet",
    bulletLevels(BULLET_GLYPHS[glyphName]),
    BULLET_GLYPHS[glyphName],
    `${BULLET_GLYPHS[glyphName]} ${BULLET_GLYPHS.circle} ${BULLET_GLYPHS.square}`,
  ),
);

const NUMBER_PRESETS: DocxListPreset[] = (Object.keys(NUMBER_STYLES) as DocxNumberStyle[]).map((style) => {
  const spec = NUMBER_STYLES[style];
  return preset(`number-${style}`, "numbers", "ordered", numberLevels(spec), spec.sample, spec.sample);
});

const MULTILEVEL_PRESETS: DocxListPreset[] = [
  preset("multilevel-decimal", "multilevel", "ordered", decimalChainLevels(), "1.", "1. 1.1. 1.1.1."),
  preset("multilevel-chinese", "multilevel", "ordered", chineseChainLevels(), "一、", "一、 (一) 1."),
  preset("multilevel-bullet", "multilevel", "bullet", bulletLevels(BULLET_GLYPHS.dot), BULLET_GLYPHS.dot, `${BULLET_GLYPHS.dot} ${BULLET_GLYPHS.circle} ${BULLET_GLYPHS.square}`),
];

/** Every gallery entry, in group order (bullets, numbers, multilevel). */
export const DOCX_LIST_PRESETS: readonly DocxListPreset[] = [...BULLET_PRESETS, ...NUMBER_PRESETS, ...MULTILEVEL_PRESETS];

export function listPresetById(id: string): DocxListPreset | undefined {
  return DOCX_LIST_PRESETS.find((entry) => entry.id === id);
}

export function listPresetsOf(group: DocxListPresetGroup): DocxListPreset[] {
  return DOCX_LIST_PRESETS.filter((entry) => entry.group === group);
}

/** A fresh levels array so a pending definition never aliases the gallery. */
export function clonePresetLevels(levels: readonly DocxNumberingLevelSpec[]): DocxNumberingLevelSpec[] {
  return levels.map((level) => ({ ...level }));
}

/** The editor's list-numbering storage (upstream ListNumberingStorage): the
 * definitions its compute reads. Absent on editors built without the
 * numbering extension. */
interface ListNumberingStorage {
  defs?: Map<string, DocxNumberingDef>;
}

function numberingStorage(editor: Editor | null): ListNumberingStorage | null {
  if (!editor || editor.isDestroyed) return null;
  const storage = (editor.storage as unknown as { listNumbering?: ListNumberingStorage }).listNumbering;
  return storage ?? null;
}

/** The definitions the editor renders markers from: the open parse's own plus
 * every overlay this session added (mutating it is the overlay channel). */
export function listDefsOf(editor: Editor | null): Map<string, DocxNumberingDef> {
  const defs = numberingStorage(editor)?.defs;
  return defs instanceof Map ? defs : new Map<string, DocxNumberingDef>();
}

/** Write a definition into the list-numbering storage so the editor draws its
 * markers before a save writes the part (upstream App overlayNumberingDef:33
 * replaces the Map so the extension's identity checks see the change). */
export function overlayListDef(editor: Editor | null, def: DocxNumberingDef): void {
  const storage = numberingStorage(editor);
  if (!storage) return;
  const defs = storage.defs instanceof Map ? storage.defs : new Map<string, DocxNumberingDef>();
  storage.defs = new Map(defs).set(def.numId, def);
}

/** The next free numeric numId: one above every definition the document
 * carries and every pending edit, never below 2 (the blank template occupies
 * numIds 1/2 when the save creates the part — blank.ts:23). */
export function nextListNumId(defs: ReadonlyMap<string, DocxNumberingDef>, pending: DocxNumberingSnapshot): string {
  let max = 2;
  const consider = (id: string): void => {
    const value = Number.parseInt(id, 10);
    if (Number.isFinite(value)) max = Math.max(max, value);
  };
  for (const id of defs.keys()) consider(id);
  for (const def of pending.newDefs) consider(def.numId);
  for (const restart of pending.restartNums) consider(restart.numId);
  return String(max + 1);
}

/** The kind a definition draws: its first level's format (genoffice
 * numbering-actions.ts:100 reads the same field). */
export function listDefKind(def: DocxNumberingDef): DocxListKind {
  return def.levels?.[0]?.numFmt === "bullet" ? "bullet" : "ordered";
}

/** The definition a new list can share through a restart num: the first
 * same-kind definition that is not an overlay of this session's own pending
 * newDef (those have no abstractNum in the part yet). */
export function findRestartableDef(
  defs: ReadonlyMap<string, DocxNumberingDef>,
  pending: DocxNumberingSnapshot,
  kind: DocxListKind,
): DocxNumberingDef | undefined {
  for (const def of defs.values()) {
    if (listDefKind(def) !== kind) continue;
    if (pending.newDefs.some((entry) => entry.numId === def.numId)) continue;
    return def;
  }
  return undefined;
}

/** The blank-template level shapes (blank.ts:67-86): bullets carry no text so
 * the renderer draws its per-level default glyphs. */
export function blankStyleLevels(kind: DocxListKind): DocxNumberingLevelSpec[] {
  return Array.from({ length: 5 }, (_, ilvl) => ({
    numFmt: kind === "bullet" ? "bullet" : "decimal",
    lvlText: kind === "bullet" ? "" : `%${ilvl + 1}.`,
    indentLeft: 720 * (ilvl + 1),
    hanging: 360,
  }));
}

function levelOf(spec: DocxNumberingLevelSpec): DocxNumberingLevel {
  return {
    numFmt: spec.numFmt,
    lvlText: spec.lvlText,
    start: spec.start ?? 1,
    indentLeft: spec.indentLeft,
    hanging: spec.hanging ?? 360,
  };
}

/** The overlay definition for a pending newDef: the save assigns the real
 * abstractNum id, so the display copy uses a placeholder one. */
export function overlayDefForNew(def: DocxNewNumberingDef): DocxNumberingDef {
  const levels = def.levels?.length ? def.levels : blankStyleLevels(def.kind);
  return {
    numId: def.numId,
    abstractNumId: `pending-${def.numId}`,
    levels: Object.fromEntries(levels.map((level, ilvl) => [ilvl, levelOf(level)])),
    startOverrides: {},
  };
}

/** The overlay definition for a restart num: the source abstractNum's levels,
 * the new numId and the start overrides (genoffice numbering-actions.ts:156). */
export function overlayDefForRestart(
  defs: ReadonlyMap<string, DocxNumberingDef>,
  restart: DocxRestartNumbering,
): DocxNumberingDef | null {
  for (const def of defs.values()) {
    if (def.abstractNumId === restart.abstractNumId) {
      return { ...def, numId: restart.numId, startOverrides: { ...restart.startOverrides } };
    }
  }
  return null;
}

/** The definition's levels, sorted for the picker; an undefined level keeps
 * Word's decimal fallback so the row still shows. */
export function listLevelInfos(def: DocxNumberingDef | undefined): DocxListLevelInfo[] {
  if (!def) return [];
  return Object.entries(def.levels)
    .map(([ilvl, level]) => ({
      ilvl: Number(ilvl),
      numFmt: typeof level.numFmt === "string" ? level.numFmt : "decimal",
      lvlText: typeof level.lvlText === "string" ? level.lvlText : "",
    }))
    .filter((info) => Number.isInteger(info.ilvl) && info.ilvl >= 0 && info.ilvl <= DOCX_LIST_MAX_LEVEL)
    .sort((left, right) => left.ilvl - right.ilvl);
}

/** The marker a level shows when every counter reads 1 — the picker's preview.
 * A bullet without text falls back to the renderer's default glyph. */
export function levelPreviewText(level: Pick<DocxListLevelInfo, "numFmt" | "lvlText">): string {
  if (level.numFmt === "bullet") return level.lvlText.length > 0 ? level.lvlText : "•";
  return level.lvlText.replace(/%(\d)/g, "1");
}
