// Read path for the tables a workbook ships (UNI-926 FB-3): each worksheet's
// <tableParts> -> worksheet relationships -> xl/tables/tableN.xml. Read-only
// metadata for the contextual Table tabs; the write path is tables.ts. Every
// reader here is tolerant: a missing or malformed part yields no table, never
// a throw (same hardening as parseDefinedNamesXml).
import { attribute, decodeXml, elements, sectionInner } from "./render-model-xml.ts";

/** One table the opened workbook carries. `area` is 0-based and
 *  header-inclusive, the same shape `create_table` pins. */
export interface XlsxRenderTable {
  readonly name: string;
  readonly area: { readonly startRow: number; readonly startColumn: number; readonly endRow: number; readonly endColumn: number };
  readonly columnNames: readonly string[];
  readonly style?: string | undefined;
  readonly bandedRows: boolean;
  readonly headerRow: boolean;
  readonly totalsRow: boolean;
}

type RefParser = (ref: string) => { startRow: number; endRow: number; startColumn: number; endColumn: number } | null;

const isOn = (value: string | undefined): boolean => value === "1" || value === "true";

/** `xl/worksheets/sheet1.xml` -> `xl/worksheets/_rels/sheet1.xml.rels`. */
function worksheetRelsPath(sheetPath: string): string {
  const slash = sheetPath.lastIndexOf("/");
  return `${sheetPath.slice(0, slash + 1)}_rels/${sheetPath.slice(slash + 1)}.rels`;
}

/** Resolve a relationship target against the part that owns the rels file. */
function resolveTarget(sheetPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = sheetPath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/** Package paths of the table parts a worksheet lists in `<tableParts>`. */
function tablePartPaths(sheetXml: string, sheetRelsXml: string | null | undefined, sheetPath: string): string[] {
  if (!sheetRelsXml) return [];
  const wanted = new Set<string>();
  for (const part of elements(sectionInner(sheetXml, "tableParts"), "tablePart")) {
    const id = attribute(part.tag, "r:id");
    if (id !== undefined) wanted.add(id);
  }
  if (wanted.size === 0) return [];
  const paths: string[] = [];
  for (const rel of elements(sheetRelsXml, "Relationship")) {
    const id = attribute(rel.tag, "Id");
    const target = attribute(rel.tag, "Target");
    if (id === undefined || target === undefined || !wanted.has(id)) continue;
    if (!/\/table$/.test(attribute(rel.tag, "Type") ?? "")) continue;
    paths.push(resolveTarget(sheetPath, decodeXml(target)));
  }
  return paths;
}

/** Parse one `xl/tables/tableN.xml`; null when it cannot be modelled. */
function parseTableXml(xml: string, parseRef: RefParser): XlsxRenderTable | null {
  const root = elements(xml, "table")[0];
  if (!root) return null;
  const rawName = attribute(root.tag, "name") ?? attribute(root.tag, "displayName");
  const ref = attribute(root.tag, "ref");
  if (rawName === undefined || rawName === "" || ref === undefined) return null;
  const range = parseRef(decodeXml(ref));
  if (!range) return null;
  const columnNames = elements(sectionInner(xml, "tableColumns"), "tableColumn").map((column) =>
    decodeXml(attribute(column.tag, "name") ?? ""),
  );
  const styleInfo = elements(xml, "tableStyleInfo")[0];
  const style = styleInfo === undefined ? undefined : attribute(styleInfo.tag, "name");
  const totalsCount = Number(attribute(root.tag, "totalsRowCount") ?? 0);
  return {
    name: decodeXml(rawName),
    area: { startRow: range.startRow, startColumn: range.startColumn, endRow: range.endRow, endColumn: range.endColumn },
    columnNames,
    ...(style === undefined || style === "" ? {} : { style: decodeXml(style) }),
    bandedRows: styleInfo === undefined ? false : isOn(attribute(styleInfo.tag, "showRowStripes")),
    headerRow: attribute(root.tag, "headerRowCount") !== "0",
    totalsRow: Number.isFinite(totalsCount) && totalsCount > 0,
  };
}

/**
 * Read every worksheet's tables. `read` is the package entry reader; a failed
 * read or an unparsable part drops that table only.
 */
export async function readSheetTables(
  sheets: readonly { readonly path: string | undefined; readonly xml: string | null | undefined }[],
  read: (paths: readonly string[]) => Promise<Readonly<Record<string, string | null>>>,
  parseRef: RefParser,
): Promise<XlsxRenderTable[][]> {
  const empty = sheets.map((): XlsxRenderTable[] => []);
  try {
    const relsPaths = sheets.flatMap((sheet) => (sheet.path && sheet.xml ? [worksheetRelsPath(sheet.path)] : []));
    if (relsPaths.length === 0) return empty;
    const rels = await read(relsPaths);
    const partsBySheet = sheets.map((sheet) =>
      sheet.path && sheet.xml ? tablePartPaths(sheet.xml, rels[worksheetRelsPath(sheet.path)], sheet.path) : [],
    );
    const allParts = [...new Set(partsBySheet.flat())];
    if (allParts.length === 0) return empty;
    const xmls = await read(allParts);
    return partsBySheet.map((parts) =>
      parts.flatMap((part) => {
        const xml = xmls[part];
        if (!xml) return [];
        try {
          const table = parseTableXml(xml, parseRef);
          return table ? [table] : [];
        } catch {
          return [];
        }
      }),
    );
  } catch {
    return empty;
  }
}
