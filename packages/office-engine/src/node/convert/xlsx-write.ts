import type { BiffSheet } from "./biff8.ts";
import { writeZip, type ZipInput } from "./zip.ts";

// Minimal SpreadsheetML writer for the Q7 converter: one worksheet part per
// source sheet, inline strings (no sharedStrings part), a minimal stylesheet,
// and the relationship graph the engine's xlsx gateway needs to reopen the
// package. Values are written as numbers when the source cell is numeric.

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function writeXlsxPackage(sheets: readonly BiffSheet[]): Uint8Array {
  const entries: ZipInput[] = [
    { path: "[Content_Types].xml", data: xml(contentTypes(sheets.length)) },
    { path: "_rels/.rels", data: xml(ROOT_RELS) },
    { path: "xl/workbook.xml", data: xml(workbookXml(sheets)) },
    { path: "xl/_rels/workbook.xml.rels", data: xml(workbookRels(sheets.length)) },
    { path: "xl/styles.xml", data: xml(STYLES) },
  ];
  sheets.forEach((sheet, index) => {
    entries.push({ path: `xl/worksheets/sheet${index + 1}.xml`, data: xml(worksheetXml(sheet)) });
  });
  return writeZip(entries);
}

function contentTypes(sheetCount: number): string {
  const overrides = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  ];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  }
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides.join("") +
    "</Types>"
  );
}

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

function workbookXml(sheets: readonly BiffSheet[]): string {
  const list = sheets
    .map((sheet, index) => `<sheet name="${escapeAttribute(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return (
    XML_DECL +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" +
    list +
    "</sheets></workbook>"
  );
}

function workbookRels(sheetCount: number): string {
  const rels: string[] = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`,
    );
  }
  rels.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  );
  return XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join("") + "</Relationships>";
}

const STYLES =
  XML_DECL +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  "</styleSheet>";

function worksheetXml(sheet: BiffSheet): string {
  const rows = new Map<number, { ref: string; cell: { text: string; number?: number } }[]>();
  for (const [ref, cell] of sheet.cells) {
    const parsed = parseRef(ref);
    const list = rows.get(parsed.row) ?? [];
    list.push({ ref, cell });
    rows.set(parsed.row, list);
  }
  const rowXml = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, cells]) => {
      cells.sort((a, b) => parseRef(a.ref).col - parseRef(b.ref).col);
      return `<row r="${row + 1}">${cells.map(({ ref, cell }) => cellXml(ref, cell)).join("")}</row>`;
    })
    .join("");
  return (
    XML_DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dimension(sheet)}"/>` +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

function cellXml(ref: string, cell: { text: string; number?: number }): string {
  if (cell.number !== undefined) return `<c r="${ref}"><v>${cell.number}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeText(cell.text)}</t></is></c>`;
}

function dimension(sheet: BiffSheet): string {
  if (sheet.cells.size === 0) return "A1";
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -1;
  let maxCol = -1;
  for (const ref of sheet.cells.keys()) {
    const { row, col } = parseRef(ref);
    minRow = Math.min(minRow, row);
    minCol = Math.min(minCol, col);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }
  return `${refName(minCol, minRow)}:${refName(maxCol, maxRow)}`;
}

function parseRef(ref: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) throw new Error(`bad cell reference ${ref}`);
  let col = 0;
  for (const ch of match[1] ?? "") col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2] ?? 0) - 1, col: col - 1 };
}

function refName(col: number, row: number): string {
  let name = "";
  for (let c = col; c >= 0; c = Math.floor(c / 26) - 1) name = String.fromCharCode(65 + (c % 26)) + name;
  return `${name}${row + 1}`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
