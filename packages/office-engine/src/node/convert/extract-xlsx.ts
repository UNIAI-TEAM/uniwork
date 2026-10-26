import {
  decodeXml,
  ExtractTypedError,
  readAttr,
  resolveZipTarget,
  TextBudgetBuilder,
  type SelectiveZip,
} from "./extract-shared.ts";

const MAX_XLSX_COL = 16_383; // XFD (1-based 16384)
const MAX_XLSX_ROW = 1_048_576;
const CELL_REF_RE = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;
const ROW_REF_RE = /^[1-9]\d{0,6}$/;

function decodeXlsxCellText(s: string): string {
  let text = decodeXml(s).replace(/\r\n?/g, "\n");
  if (text.includes("_x")) {
    text = text
      .replace(
        /_x([Dd][89ABab][0-9A-Fa-f]{2})__x([Dd][CDEFcdef][0-9A-Fa-f]{2})_/g,
        (_, hiHex: string, loHex: string) => {
          const hi = parseInt(hiHex, 16);
          const lo = parseInt(loHex, 16);
          return String.fromCodePoint(((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000);
        },
      )
      .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h: string) => {
        const code = parseInt(h, 16);
        return code >= 0xd800 && code <= 0xdfff ? m : String.fromCharCode(code);
      })
      .replace(/\r\n?/g, "\n");
  }
  return text;
}

function extractRstText(rstXml: string): string {
  const withoutPhonetic = rstXml.replace(/<(?:\w+:)?rPh\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?rPh>)/g, "");
  const tRe = /<(?:\w+:)?t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let tm: RegExpExecArray | null;
  const parts: string[] = [];
  while ((tm = tRe.exec(withoutPhonetic)) !== null) {
    if (tm[2] !== undefined) {
      parts.push(decodeXlsxCellText(tm[2]));
    }
  }
  return parts.join("");
}

function parseCellRef(ref: string): { col: number; row: number } {
  const m = CELL_REF_RE.exec(ref);
  if (!m) {
    throw new ExtractTypedError("corrupted", `invalid cell reference ${ref}`);
  }
  const colLetters = m[1]!;
  let col1 = 0;
  for (let i = 0; i < colLetters.length; i++) {
    const c = colLetters.charCodeAt(i);
    const digit = c >= 65 && c <= 90 ? c - 64 : c - 96;
    col1 = col1 * 26 + digit;
  }
  const col = col1 - 1;
  const row = Number(m[2]!);
  if (col < 0 || col > MAX_XLSX_COL || row < 1 || row > MAX_XLSX_ROW) {
    throw new ExtractTypedError("corrupted", `cell reference out of bounds ${ref}`);
  }
  return { col, row };
}

function csvEscape(val: string): string {
  if (val === "") return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

export function extractXlsxFirstSheetCsv(zip: SelectiveZip): { text: string; truncated: boolean } {
  const workbookXml = zip.readText("xl/workbook.xml");
  if (workbookXml === null) throw new ExtractTypedError("corrupted", "missing xl/workbook.xml");

  const sheetMatch = /<(?:\w+:)?sheet\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/.exec(workbookXml);
  if (!sheetMatch) throw new ExtractTypedError("corrupted", "workbook has no sheets");
  const sheetAttrs = sheetMatch[1] ?? "";
  const rId = readAttr(sheetAttrs, "r:id") ?? readAttr(sheetAttrs, "id") ?? "";
  if (!rId) throw new ExtractTypedError("corrupted", "first sheet has no relationship id");

  const relsXml = zip.readText("xl/_rels/workbook.xml.rels");
  if (relsXml === null) throw new ExtractTypedError("corrupted", "missing xl/_rels/workbook.xml.rels");

  let sheetPath: string | null = null;
  for (const rm of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const relAttrs = rm[1] ?? "";
    if (readAttr(relAttrs, "Id") === rId) {
      const target = (readAttr(relAttrs, "Target") ?? "").trim();
      if (target) {
        sheetPath = resolveZipTarget("xl/workbook.xml", target);
      }
      break;
    }
  }
  if (!sheetPath) {
    throw new ExtractTypedError("corrupted", `unresolved worksheet relationship ${rId}`);
  }
  const worksheetXml = zip.readText(sheetPath);
  if (worksheetXml === null) throw new ExtractTypedError("corrupted", `missing worksheet ${sheetPath}`);

  const shared: string[] = [];
  const sharedXml = zip.readText("xl/sharedStrings.xml");
  if (sharedXml !== null) {
    const siRe = /<(?:\w+:)?si\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
    let sim: RegExpExecArray | null;
    while ((sim = siRe.exec(sharedXml)) !== null) {
      const siBody = sim[2];
      shared.push(siBody !== undefined ? extractRstText(siBody) : "");
    }
  }

  const builder = new TextBudgetBuilder();
  let lastRow = 0;
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(worksheetXml)) !== null) {
    const rowAttrs = rowMatch[1] ?? "";
    const rowBody = rowMatch[2] ?? "";
    const rowRef = readAttr(rowAttrs, "r");
    let explicitRowNum: number | undefined;
    if (rowRef !== undefined) {
      if (!ROW_REF_RE.test(rowRef)) {
        throw new ExtractTypedError("corrupted", `invalid row reference ${rowRef}`);
      }
      explicitRowNum = Number(rowRef);
      if (explicitRowNum < 1 || explicitRowNum > MAX_XLSX_ROW || explicitRowNum <= lastRow) {
        throw new ExtractTypedError("corrupted", `row reference out of bounds ${rowRef}`);
      }
    }

    const rowCells = new Map<number, string>();
    let nextSequentialCol = 0;
    let inferredRowNum: number | undefined;

    if (rowBody) {
      const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rowBody)) !== null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const ref = readAttr(attrs, "r");
        let col: number;
        if (ref !== undefined) {
          const parsed = parseCellRef(ref);
          col = parsed.col;
          if (inferredRowNum === undefined) inferredRowNum = parsed.row;
        } else {
          col = nextSequentialCol;
          if (col > MAX_XLSX_COL) {
            throw new ExtractTypedError("corrupted", `cell column out of bounds ${col}`);
          }
        }
        nextSequentialCol = col + 1;
        if (!body) continue;

        const type = readAttr(attrs, "t") ?? "";
        let text = "";
        if (type === "inlineStr") {
          text = extractRstText(body);
        } else {
          const vm = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
          const rawVal = vm?.[1];
          if (rawVal !== undefined) {
            if (type === "s") text = shared[Number(rawVal)] ?? "";
            else if (type === "b") text = rawVal.trim() === "1" ? "TRUE" : "FALSE";
            else text = decodeXlsxCellText(rawVal);
          }
        }
        rowCells.set(col, csvEscape(text));
      }
    }

    let rowNum: number;
    if (explicitRowNum !== undefined) {
      rowNum = explicitRowNum;
    } else if (inferredRowNum !== undefined && inferredRowNum > lastRow) {
      rowNum = inferredRowNum;
    } else {
      rowNum = lastRow + 1;
      if (rowNum > MAX_XLSX_ROW) {
        throw new ExtractTypedError("corrupted", `row count exceeds ${MAX_XLSX_ROW}`);
      }
    }

    const gapNewlines = lastRow === 0 ? rowNum - 1 : rowNum - lastRow;
    lastRow = rowNum;
    if (!builder.appendRepeatChar("\n", gapNewlines)) break;

    if (rowCells.size > 0) {
      const sortedCols = [...rowCells.keys()].sort((a, b) => a - b);
      let currentCol = 0;
      for (const col of sortedCols) {
        const commaGap = col - currentCol;
        if (!builder.appendRepeatChar(",", commaGap)) break;
        const escaped = rowCells.get(col) ?? "";
        if (!builder.append(escaped)) break;
        currentCol = col;
      }
      if (builder.truncated) break;
    }
  }

  return builder.finish();
}
