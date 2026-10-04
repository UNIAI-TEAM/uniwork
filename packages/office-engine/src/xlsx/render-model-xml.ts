// XML scanning helpers shared by the XLSX model readers.
export const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec), 10))
    .replace(/&amp;/g, "&");

export const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1];
};

/** All `<name …>body</name>` / `<name …/>` elements, bodies included. */
export function elements(xml: string, name: string): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = [];
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push({ tag: match[1] ?? "", body: match[2] ?? "" });
  }
  return out;
}

export function sectionInner(xml: string, name: string): string {
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`);
  return pattern.exec(xml)?.[1] ?? "";
}

/** One workbook defined name as read from `xl/workbook.xml`'s
 *  `<definedNames>` section. `sheetIndex` is the 0-based position in
 *  workbook sheet order (`localSheetId`); absent means workbook scope, and
 *  `-1` marks a malformed `localSheetId` (not non-empty digits) so callers
 *  treat the entry as unmodelable instead of silently re-scoping it. */
export interface XlsxParsedDefinedName {
  readonly name: string;
  readonly formula: string;
  readonly sheetIndex?: number | undefined;
  readonly hidden?: boolean | undefined;
}

/**
 * Scan `<definedNames>` in a workbook.xml string into name entries. Both the
 * self-closing and body forms are read; `localSheetId` and `hidden` are parsed
 * so callers can tell which names the name-manager form can model. The reader
 * stays regex-based like the rest of this module (no DOM dependency).
 */
export function parseDefinedNamesXml(workbookXml: string): XlsxParsedDefinedName[] {
  const names: XlsxParsedDefinedName[] = [];
  for (const entry of elements(sectionInner(workbookXml, "definedNames"), "definedName")) {
    const rawName = attribute(entry.tag, "name");
    if (rawName === undefined || rawName === "") continue;
    const name = decodeXml(rawName);
    const formula = decodeXml(entry.body.trim());
    const localSheetId = attribute(entry.tag, "localSheetId");
    // F5: require non-empty digits. `Number("")` is 0 and `Number("x")` is NaN,
    // so a malformed value must not silently become workbook scope or sheet 0.
    // The -1 sentinel leaves the entry unmodelable: the name manager preserves
    // it (seedDefinedNames) and the vendored loader leaves it file-only.
    const sheetIndex =
      localSheetId === undefined ? undefined : /^\d+$/.test(localSheetId) ? Number.parseInt(localSheetId, 10) : -1;
    const hidden = /^(?:1|true)$/.test(attribute(entry.tag, "hidden") ?? "");
    names.push({
      name,
      formula,
      ...(sheetIndex === undefined ? {} : { sheetIndex }),
      ...(hidden ? { hidden: true } : {}),
    });
  }
  return names;
}

// ── Colors ─────────────────────────────────────────────────────────────────
