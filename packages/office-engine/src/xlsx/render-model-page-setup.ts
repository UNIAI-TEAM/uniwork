// UNI-952: the worksheet's own page layout, read for print. The render model
// carried no page setup, so a printed sheet could not honour the file's
// orientation, paper, margins, scale / fit or manual breaks. This reader scans
// the five worksheet parts that hold them (<sheetPr><pageSetUpPr>,
// <printOptions>, <pageMargins>, <pageSetup>, <rowBreaks>/<colBreaks>) and the
// <headerFooter> text; print area and print titles stay where they live, in
// the workbook defined names.
import type { XlsxRenderHeaderFooterPictureMedia, XlsxRenderHeaderFooterPictures } from "./render-model-hf-pictures.ts";
import { attribute, decodeXml, elements, sectionInner } from "./render-model-xml.ts";

/** The header/footer strings as the file stores them (Excel's `&L&C&R` codes
 *  kept verbatim; the print copy interprets them). `first*` apply only when
 *  `differentFirst` is set, `even*` only when `differentOddEven` is. */
export interface XlsxRenderHeaderFooter {
  readonly oddHeader?: string | undefined;
  readonly oddFooter?: string | undefined;
  readonly firstHeader?: string | undefined;
  readonly firstFooter?: string | undefined;
  readonly evenHeader?: string | undefined;
  readonly evenFooter?: string | undefined;
  readonly differentFirst?: boolean | undefined;
  readonly differentOddEven?: boolean | undefined;
  /** The `&G` pictures by VML shape id (LH, CF, RHEVEN, ...); filled by the
   *  render model when the gateway reads binary parts. */
  readonly pictures?: XlsxRenderHeaderFooterPictures | undefined;
  /** The data: URL of each media part `pictures` names, by media path (each
   *  held once however many shapes use it). */
  readonly pictureMedia?: XlsxRenderHeaderFooterPictureMedia | undefined;
}

/** The file's page margins, in inches (OOXML <pageMargins> units). */
export interface XlsxRenderPageMargins {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly header?: number | undefined;
  readonly footer?: number | undefined;
}

/** The worksheet's page layout as the file declares it. Absent = not set in
 *  the file (the printer default applies). Breaks are the 0-based index of
 *  the first row/column AFTER the break (the OOXML `brk id`). */
export interface XlsxRenderPageSetup {
  readonly orientation?: "portrait" | "landscape" | undefined;
  readonly paperSize?: number | undefined;
  readonly scale?: number | undefined;
  readonly fitToPage?: boolean | undefined;
  readonly fitToWidth?: number | undefined;
  readonly fitToHeight?: number | undefined;
  readonly margins?: XlsxRenderPageMargins | undefined;
  readonly printGridlines?: boolean | undefined;
  readonly printHeadings?: boolean | undefined;
  readonly horizontalCentered?: boolean | undefined;
  readonly verticalCentered?: boolean | undefined;
  readonly rowBreaks?: readonly number[] | undefined;
  readonly colBreaks?: readonly number[] | undefined;
  readonly headerFooter?: XlsxRenderHeaderFooter | undefined;
}

const isTrue = (value: string | undefined): boolean => value === "1" || value === "true";

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function breaksOf(xml: string, section: string): number[] {
  const ids = elements(sectionInner(xml, section), "brk")
    .map((entry) => finiteNumber(attribute(entry.tag, "id")))
    .filter((id): id is number => id !== undefined && Number.isInteger(id) && id > 0);
  return [...new Set(ids)].sort((left, right) => left - right);
}

/** Header/footer text are capped like Excel's own 255-character limit. */
const MAX_HEADER_TEXT = 255;

function headerFooterOf(xml: string): XlsxRenderHeaderFooter | undefined {
  const section = elements(xml, "headerFooter")[0];
  if (!section) return undefined;
  const out: { -readonly [K in keyof XlsxRenderHeaderFooter]: XlsxRenderHeaderFooter[K] } = {};
  for (const key of ["oddHeader", "oddFooter", "firstHeader", "firstFooter", "evenHeader", "evenFooter"] as const) {
    const text = decodeXml(sectionInner(section.body, key)).slice(0, MAX_HEADER_TEXT);
    if (text !== "") out[key] = text;
  }
  if (isTrue(attribute(section.tag, "differentFirst"))) out.differentFirst = true;
  if (isTrue(attribute(section.tag, "differentOddEven"))) out.differentOddEven = true;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The page layout of one worksheet XML, or undefined when it declares none. */
export function parseWorksheetPageSetup(xml: string): XlsxRenderPageSetup | undefined {
  const out: {
    -readonly [K in keyof XlsxRenderPageSetup]: XlsxRenderPageSetup[K];
  } = {};

  const setUpPr = elements(sectionInner(xml, "sheetPr"), "pageSetUpPr")[0];
  if (setUpPr && attribute(setUpPr.tag, "fitToPage") !== undefined) out.fitToPage = isTrue(attribute(setUpPr.tag, "fitToPage"));

  const options = elements(xml, "printOptions")[0];
  if (options) {
    const gridLines = attribute(options.tag, "gridLines");
    const headings = attribute(options.tag, "headings");
    const horizontal = attribute(options.tag, "horizontalCentered");
    const vertical = attribute(options.tag, "verticalCentered");
    if (gridLines !== undefined) out.printGridlines = isTrue(gridLines);
    if (headings !== undefined) out.printHeadings = isTrue(headings);
    if (horizontal !== undefined) out.horizontalCentered = isTrue(horizontal);
    if (vertical !== undefined) out.verticalCentered = isTrue(vertical);
  }

  const margins = elements(xml, "pageMargins")[0];
  if (margins) {
    const left = finiteNumber(attribute(margins.tag, "left"));
    const right = finiteNumber(attribute(margins.tag, "right"));
    const top = finiteNumber(attribute(margins.tag, "top"));
    const bottom = finiteNumber(attribute(margins.tag, "bottom"));
    if (left !== undefined && right !== undefined && top !== undefined && bottom !== undefined) {
      const header = finiteNumber(attribute(margins.tag, "header"));
      const footer = finiteNumber(attribute(margins.tag, "footer"));
      out.margins = {
        left: Math.max(0, left),
        right: Math.max(0, right),
        top: Math.max(0, top),
        bottom: Math.max(0, bottom),
        ...(header === undefined ? {} : { header }),
        ...(footer === undefined ? {} : { footer }),
      };
    }
  }

  const setup = elements(xml, "pageSetup")[0];
  if (setup) {
    const orientation = attribute(setup.tag, "orientation");
    if (orientation === "portrait" || orientation === "landscape") out.orientation = orientation;
    const paperSize = finiteNumber(attribute(setup.tag, "paperSize"));
    if (paperSize !== undefined && Number.isInteger(paperSize) && paperSize > 0) out.paperSize = paperSize;
    const scale = finiteNumber(attribute(setup.tag, "scale"));
    if (scale !== undefined && scale >= 10 && scale <= 400) out.scale = scale;
    const fitToWidth = finiteNumber(attribute(setup.tag, "fitToWidth"));
    if (fitToWidth !== undefined && fitToWidth >= 0) out.fitToWidth = fitToWidth;
    const fitToHeight = finiteNumber(attribute(setup.tag, "fitToHeight"));
    if (fitToHeight !== undefined && fitToHeight >= 0) out.fitToHeight = fitToHeight;
  }

  const rowBreaks = breaksOf(xml, "rowBreaks");
  if (rowBreaks.length > 0) out.rowBreaks = rowBreaks;
  const colBreaks = breaksOf(xml, "colBreaks");
  if (colBreaks.length > 0) out.colBreaks = colBreaks;
  const headerFooter = headerFooterOf(xml);
  if (headerFooter) out.headerFooter = headerFooter;

  return Object.keys(out).length === 0 ? undefined : out;
}
