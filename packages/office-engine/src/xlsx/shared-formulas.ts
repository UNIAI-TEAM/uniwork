// Shared-formula followers — the cells readBasicWorkbook reads as literals.
//
// Excel stores a filled-down formula once: the group's master carries
// `<f t="shared" ref="C2:C5" si="0">B2*2</f>` and every other member a
// text-less `<f t="shared" si="0"/>`. The gateway's basic parse
// (parseWorksheetCells) only types a cell as a formula when its <f> has text,
// so a follower lands in the snapshot as its cached <v>, never as a formula,
// and a recalc planned from the snapshot alone would leave its <v> stale
// while the master's refreshes. This reader finds the followers in the sheet
// XML so the recalc can ask for their VALUE by coordinate; their formula text
// is never expanded or invented — the gateway's values-only patch
// (patchFormulaCachedValue accepts any `<f[\s/>]` cell) rewrites only <v>.
import type { XlsxGatewayFunctions } from "./engine.ts";
import { attribute, decodeXml, elements, sectionInner } from "./render-model-xml.ts";

/** Sheet name (as the package names it) → follower A1 addresses. */
export type XlsxSharedFollowers = ReadonlyMap<string, ReadonlySet<string>>;

// Paired <c> only, as the write path: a self-closing <c/> holds no <f>.
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
// A self-closing <f t="shared" si=".."/>: text-less, so the basic parse never
// read it. Other text-less kinds (a dataTable <f/>) stay out.
const SELF_CLOSING_F = /<f\b[^>]*\st="shared"[^>]*\/>/;

/** Follower addresses of one worksheet part. */
export function sharedFollowersOfSheetXml(xml: string): Set<string> {
  const out = new Set<string>();
  for (const match of xml.matchAll(CELL)) {
    const body = match[2];
    if (body === undefined || !SELF_CLOSING_F.test(body)) continue;
    const address = attribute(match[1] ?? "", "r");
    if (address !== undefined && /^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(address)) out.add(address);
  }
  return out;
}

/** Every sheet's followers, resolved through workbook.xml + its rels. A
 *  sheet with none is absent from the map. */
export async function readSharedFollowers(engine: XlsxGatewayFunctions, bytes: Uint8Array): Promise<XlsxSharedFollowers> {
  const base = await engine.readEntriesText(bytes, ["xl/workbook.xml", "xl/_rels/workbook.xml.rels"]);
  const pathById = new Map<string, string>();
  for (const rel of elements(base["xl/_rels/workbook.xml.rels"] ?? "", "Relationship")) {
    const id = attribute(rel.tag, "Id");
    const target = attribute(rel.tag, "Target");
    if (!id || !target || !/\/worksheet$/.test(attribute(rel.tag, "Type") ?? "")) continue;
    pathById.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/"));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const sheet of elements(sectionInner(base["xl/workbook.xml"] ?? "", "sheets"), "sheet")) {
    const name = attribute(sheet.tag, "name");
    const path = pathById.get(attribute(sheet.tag, "r:id") ?? "");
    if (name && path) sheets.push({ name: decodeXml(name), path });
  }
  const out = new Map<string, Set<string>>();
  if (sheets.length === 0) return out;
  const xmls = await engine.readEntriesText(bytes, sheets.map((sheet) => sheet.path));
  for (const sheet of sheets) {
    const followers = sharedFollowersOfSheetXml(xmls[sheet.path] ?? "");
    if (followers.size > 0) out.set(sheet.name, followers);
  }
  return out;
}
