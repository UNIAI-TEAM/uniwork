import type { Extensions, JSONContent } from "@tiptap/core";

export interface RendererRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  [key: string]: unknown;
}
export interface RendererBlock {
  type: string;
  docxIndex: number | null;
  hidden?: boolean;
  runs?: RendererRun[];
  [key: string]: unknown;
}
export interface RendererGeneratedBlock {
  type: "paragraph" | "heading" | "listItem";
  runs: RendererRun[];
  [key: string]: unknown;
}
export interface RendererParsed {
  blocks: RendererBlock[];
  [key: string]: unknown;
}
export interface RendererNote {
  id: string;
  text: string;
  noRefMark?: true;
}
interface RendererNoteAreaProps {
  notes: RendererNote[];
  numberOf?: (note: RendererNote, index: number) => number;
  readOnly?: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}
export function PageFootnotes(props: RendererNoteAreaProps & { skipIds: ReadonlySet<string> }): import("react").ReactNode;
export function PageEndnotes(props: RendererNoteAreaProps & { top: number | null }): import("react").ReactNode;
export function endnotesAnchorY(pm: HTMLElement, baseTop: number, factor: number): number | null;
export function setNoteNumFmts(props: { footnote?: { numFmt?: string }; endnote?: { numFmt?: string } }): void;
export const editorExtensions: Extensions;
export const DOCX_RENDERER_STYLE_ELEMENT_ID: string;
/** Mounts the vendored renderer stylesheet (scoped to `.docx-surface`) once per document. */
export function installDocxRendererStyles(doc?: Document): void;
export function blocksToPmDoc(blocks: RendererBlock[], sections?: unknown[], options?: { legacyTableIndent?: boolean }): JSONContent;
export function pmDocOptions(parsed: { compatibilityMode?: number }): { legacyTableIndent?: boolean };
export function inlineToRuns(content: JSONContent[]): RendererRun[];
export function pmNodeToGeneratedBlock(node: JSONContent): RendererGeneratedBlock;
export function pmDocToSavePlan(doc: JSONContent, originalBlocks: RendererBlock[]): { saveBlocks: unknown[]; saveBlockIndexByDocx: Map<number, number>; chartPatches: unknown[]; changedCount: number; deletedCount: number };
export function parseDocx(bytes: Uint8Array, options?: Record<string, unknown>): Promise<RendererParsed>;
export function saveDocx(parsed: RendererParsed, blocks: unknown[], options?: Record<string, unknown>): Promise<Uint8Array>;

// ── G3-04c T-02 pagination surface (UNI-823) ──────────────────────────────
export interface RendererSectionSettings {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  headerDist?: number;
  footerDist?: number;
  marginTopFixed?: boolean;
  marginBottomFixed?: boolean;
  [key: string]: unknown;
}
export type RendererHfVariant = "default" | "first" | "even";
export interface RendererSection {
  settings: RendererSectionSettings;
  startType?: string;
  firstBlockIndex: number;
  lastBlockIndex: number;
  titlePg?: boolean;
  pageNumberStart?: number;
  pageNumberFmt?: string;
  headerRefs?: Partial<Record<RendererHfVariant, string>>;
  footerRefs?: Partial<Record<RendererHfVariant, string>>;
}
export interface RendererHfParagraph {
  runs: Array<{ text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface RendererHfPart {
  text: string;
  hasPageNumber: boolean;
  paras: RendererHfParagraph[];
  images?: unknown[];
}
export interface RendererHeaderFooter {
  text: string;
  pageNumber?: boolean;
  paras?: RendererHfParagraph[];
}
export interface RendererBlockBox {
  top: number;
  height: number;
  el?: HTMLElement;
  docxIndex?: number;
  section?: number;
  breakBefore?: true;
  breakAfter?: true;
  breakForce?: true;
}
export interface RendererPageSlice {
  start: number;
  end: number;
  section: number;
  regions?: unknown[];
  physHeight?: number;
  repeatHeader?: { top: number; height: number };
  [key: string]: unknown;
}
export interface RendererSectionGeom {
  contentHeight: number;
  firstContentHeight?: number;
  contentWidth?: number;
  topPx?: number;
  pageHeightPx?: number;
  forceBreak: boolean;
  startType?: string;
  cols?: number;
  colWidths?: number[];
  [key: string]: unknown;
}
export interface RendererSectionHfHeights {
  headerPx: number;
  footerPx: number;
  firstHeaderPx?: number;
  firstFooterPx?: number;
}
export interface RendererHfStripGeom {
  pageW: number;
  pageH: number;
  marginLeft: number;
  marginRight: number;
  headerStripTop: number;
  footerDist: number;
  stripLeft?: number;
  [key: string]: unknown;
}
export interface RendererGapMetrics {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  sectionMarginLeft?: number;
  sectionMarginRight?: number;
  sectionMarginTop?: number;
  pageLeft?: number;
  pageWidth?: number;
}
export interface RendererPageGapSpec {
  metrics: RendererGapMetrics;
  el?: HTMLElement;
  pos?: number;
  kind?: string;
  boundaryY?: number;
  cols?: number;
  hfEls?: HTMLElement[];
  hfKey?: string;
  carryPx?: number;
  suppressLeadMt?: boolean;
  pullUp?: number;
  repeatHeaderEls?: HTMLElement[];
  repeatHeaderKey?: string;
}

export function readSections(parsed: RendererParsed): RendererSection[];
export function measureBlocks(pm: HTMLElement, origin: number, zoomFactor: number): { blocks: RendererBlockBox[]; totalHeight: number; floats: unknown[]; sectBreaks: Set<number> };
export function assignSections(blocks: RendererBlockBox[], sections: RendererSection[]): void;
export function liveSections(sections: RendererSection[], blocks: RendererBlockBox[], extraPresent?: Set<number>, trackedDeleted?: Set<number>): RendererSection[];
export function sectionGeoms(sections: RendererSection[], hfHeights?: RendererSectionHfHeights[]): RendererSectionGeom[];
export function sliceWithLineSplit(blocks: RendererBlockBox[], geoms: RendererSectionGeom[], totalHeight: number, zoomFactor: number, metaOf?: unknown, out?: { rowSplits?: unknown[]; [key: string]: unknown }): RendererPageSlice[];
export function sectionPageBox(set: RendererSectionSettings): { width: number; height: number; contentWidth: number; headerDist: number; footerDist: number };
export function effectiveTopPx(set: RendererSectionSettings, headerPx: number): number;
export function effectiveBottomPx(set: RendererSectionSettings, footerPx: number): number;
export function sectionFirstPages(slices: RendererPageSlice[]): boolean[];
export function visiblePageCount(slices: RendererPageSlice[]): number;
export function pageNumbers(slices: RendererPageSlice[], sections: RendererSection[]): number[];
export function effectiveHfRefs(sections: RendererSection[]): Array<{ header: Partial<Record<RendererHfVariant, string>>; footer: Partial<Record<RendererHfVariant, string>> }>;
export function hfVariantOf(titlePg: boolean | undefined, firstOfSection: boolean, evenOddHf: boolean, pageNo: number): RendererHfVariant;
export function formatPageNumber(n: number, fmt?: string): string;
export function lineStartAnchor(el: HTMLElement, offsetInBlock: number, zoomFactor: number, rectsOf?: unknown): { node: Text | Element; charOffset: number } | null;
export function nextLineAnchor(el: HTMLElement, offsetInBlock: number, zoomFactor: number, rectsOf?: unknown): { node: Text | Element; charOffset: number } | null;
export const GAP_BAND: number;
export function setPageGaps(view: import("@tiptap/pm/view").EditorView, gaps: RendererPageGapSpec[], firstPageEls?: { els: HTMLElement[]; key: string }): void;
export function setRowFills(view: import("@tiptap/pm/view").EditorView, fills: Array<{ el: Element; targetPx: number; extraPx?: number }>): void;
export function makeGapHfEl(opts: { kind: "header" | "footer"; value: RendererHeaderFooter; images?: unknown[]; pageNo: number | string; pageTotal: number; geom?: RendererHfStripGeom }): HTMLElement;
export function hfStripGeom(set: RendererSectionSettings): RendererHfStripGeom;
export function hfReservedHeightPx(kind: "header" | "footer", value: RendererHeaderFooter | null, contentWidthPx: number, images?: unknown[], geom?: unknown): number;
export function hfHasVisibleContent(value: RendererHeaderFooter | null | undefined, images?: unknown[]): boolean;
export function bumpHfProbeFontEpoch(): void;
export function bumpLineSampleFontEpoch(): void;

// ── G3-04d fidelity surface (UNI-823) ─────────────────────────────────────
export interface RendererTableRowFlags {
  isHeader: boolean;
  cantSplit: boolean;
  minHPx?: number;
}
export interface RendererBlockMeta {
  keepNext?: boolean;
  keepLines?: boolean;
  breakBefore?: boolean;
  widowControl?: boolean;
  suppressLineNumbers?: boolean;
  tableRowFlags?: RendererTableRowFlags[];
  modernTableHeaders?: boolean;
  footnoteExtraPx?: number;
  footnoteBands?: unknown[];
}
export interface RendererColumnGeom {
  cols: number;
  colWidthPx: number;
  gapPx: number;
  equalWidth: boolean;
  widths: number[];
  gaps: number[];
}
export interface RendererColumnBlockPlacement {
  el: HTMLElement;
  widthPx?: number;
  contentWPx?: number;
  marginLeftPx?: number;
  marginRightPx?: number;
  marginTopPx?: number;
  dx: number;
  dy: number;
  [key: string]: unknown;
}
export interface RendererPageFrame {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export function tableRowFlags(tableXml: string): RendererTableRowFlags[];
export function sectionColumns(section: RendererSection): number;
export function sectionColGeom(section: RendererSection): RendererColumnGeom;
export function sectionBidi(section: RendererSection): boolean;
/** Typed docGrid pitch (pt) when the sections agree, else null. */
export function docGridPitchPt(sections: RendererSection[]): number | null;
/** Typed docGrid charSpace delta (pt) when the sections agree, else null. */
export function docCharSpacePt(sections: RendererSection[]): number | null;
export function columnLayoutSpecs(blocks: RendererBlockBox[], slices: RendererPageSlice[], sections: RendererSection[]): RendererColumnBlockPlacement[];
export function setColumnLayout(view: import("@tiptap/pm/view").EditorView, specs: RendererColumnBlockPlacement[]): void;
export function pageFramesFromGaps(wrap: HTMLElement, zoomFactor: number, first?: { left: number; width: number }): RendererPageFrame[];

/** styles.xml + docDefaults CSS: paragraph/heading styles, theme-resolved fonts,
 *  `--doc-line-factor*`, autospace and grid rules. Generated at open, display-only. */
export function docStyleCss(parsed: RendererParsed): string;
/** Theme pick CSS (Design ▸ Themes/Fonts/Colors); pass the parse's theme fonts/colors. */
export function docThemeCss(fonts: unknown, colors: unknown, bodyFontDeclared?: boolean): string;
export function docLineFactor(parsed: RendererParsed, hasCjk: boolean): number;
export function docHasCjk(parsed: RendererParsed): boolean;
export function docBodyFont(parsed: RendererParsed): string | undefined;
