import type { LibraryRow, RowGroup } from "../library-rows";
import type { DocListScreen } from "./columns";
import { docListGroupId, type DocListGroupId, type DocListGroupScreen } from "./groups";
import { docListRowFields } from "./row-fields";

// The date groups of the list screens that group (UNI-2045 W11): the rows in
// the server's order, cut into the screen's fixed groups. Grouping loaded
// pages is right only while the server sorts by the group's own date (rule
// §8), so the page asks for that order and shows a flat list under any other.

/** Each grouped screen's groups, top to bottom; Thùng rác shows what goes first first (Q2). */
export const DOC_LIST_GROUP_ORDER: Record<DocListGroupScreen, readonly DocListGroupId[]> = {
  recent: ["today", "yesterday", "this_week", "earlier"],
  shared: ["this_week", "earlier"],
  trash: ["deleting_soon", "more_than_7_days"],
};

/** The group screen of a list screen; the screens without date groups answer null. */
export function docListGroupScreen(screen: DocListScreen): DocListGroupScreen | null {
  return screen === "recent" || screen === "shared" || screen === "trash" ? screen : null;
}

/** The date a row groups by on a screen: last activity, share date, or purge date. */
function groupDate(row: LibraryRow, screen: DocListGroupScreen): string | null {
  if (row.type !== "document") return null;
  const fields = docListRowFields(row.doc);
  if (screen === "recent") return fields.lastActivity?.at ?? null;
  if (screen === "shared") return fields.shared?.at ?? null;
  return fields.trashed?.purgeAfter ?? null;
}

/**
 * The rows as the screen's date groups, empty groups dropped. A list where no
 * row carries the screen's date (a server without SV-1/SV-3) stays one flat
 * group rather than putting everything under Trước đó.
 */
export function groupRowsByDate(rows: LibraryRow[], screen: DocListGroupScreen, now: Date): RowGroup[] {
  const dates = rows.map((row) => groupDate(row, screen));
  if (!dates.some((date) => date !== null)) return [{ key: "all", rows }];
  const byGroup = new Map<DocListGroupId, LibraryRow[]>();
  rows.forEach((row, index) => {
    const date = dates[index];
    const id = docListGroupId(screen, screen === "trash" ? { purgeAfter: date } : { at: date }, now);
    byGroup.set(id, [...(byGroup.get(id) ?? []), row]);
  });
  return DOC_LIST_GROUP_ORDER[screen].flatMap((key) => {
    const members = byGroup.get(key);
    return members ? [{ key, rows: members }] : [];
  });
}
