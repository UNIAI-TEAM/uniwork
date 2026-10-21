import type { BulkFailure } from "@uniwork/core/documents/bulk";
import type { DocumentSummaryRow, LibraryRow } from "../library-rows";
import type { DocListScreen } from "./columns";
import { docRowMenu, type RowMenuHandlers } from "./row-menu";

// The bulk bar of every document list (UNI-2045 W9), as pure functions of the
// screen, the selected rows and the commands the host wired. Who may do what
// is not decided here: a bulk action applies to a row exactly when that row's
// own menu (docRowMenu) offers the item of the same name, so the bar and the
// row menu cannot drift.
// Source: contract UNI-2045, "Quy tắc định dạng dùng chung" → Thanh hàng loạt.

export type BulkActionId = "share" | "move" | "download" | "shelve" | "trash" | "unshelve" | "restore" | "purge";

const LIVE: readonly BulkActionId[] = ["share", "move", "download", "shelve", "trash"];
const SHELVED: readonly BulkActionId[] = ["unshelve", "download", "trash"];
const TRASH: readonly BulkActionId[] = ["restore", "purge"];

/** The bar's actions of a screen, in their fixed order. */
export function bulkActionsOf(screen: DocListScreen): readonly BulkActionId[] {
  if (screen === "trash") return TRASH;
  if (screen === "shelved") return SHELVED;
  return LIVE;
}

/** One bar action over the selection: the rows it runs on and the ones it skips, unsent. */
export interface BulkPlan {
  action: BulkActionId;
  docs: DocumentSummaryRow[];
  /** `not_a_file` for a download of a page or folder, `not_shareable` for a share of a folder, `forbidden` for anything else the row does not allow. */
  skipped: BulkFailure[];
  /** Every selected row, the "/5" of "3/5". */
  total: number;
  /** Display titles of the selected rows, for the error list. */
  titles: ReadonlyMap<string, string>;
}

/** What the host gives the list to act on a selection. */
export interface DocListBulk {
  /** Whether the host can run the action at all. */
  supports: (action: BulkActionId) => boolean;
  /** Runs the plan (after its own confirmation, where it asks one); `done` clears the selection. */
  run: (plan: BulkPlan, done: () => void) => void;
}

const noop = () => {};

/**
 * Whether the share dialog would let the viewer change this row's access: the
 * row menu opens the dialog for any reader, but only a manager (or an admin
 * scope) gets its write half (`canAdministerDocument`), and a shelved document
 * gives access away only. Anyone else's row is skipped, unsent.
 */
function canShareWrite(doc: DocumentSummaryRow): boolean {
  return (doc.my_level === "manage" || doc.admin_scope === true) && !doc.shelved_at;
}

/** The bar actions of one row on a screen: the ones its row menu offers. A source row has none. */
export function rowBulkActions(row: LibraryRow, handlers: RowMenuHandlers, screen: DocListScreen): ReadonlySet<BulkActionId> {
  if (row.type !== "document") return new Set();
  const offered = new Set<string>(docRowMenu(row, { handlers, starred: false, open: noop, screen }).flat().map((item) => item.id));
  return new Set(bulkActionsOf(screen).filter((action) => offered.has(action) && (action !== "share" || canShareWrite(row.doc))));
}

function skipCode(action: BulkActionId, doc: DocumentSummaryRow): string {
  if (action === "download" && doc.kind !== "file") return "not_a_file";
  if (action === "share" && doc.kind === "folder") return "not_shareable";
  return "forbidden";
}

/**
 * The bar of a selection: each screen action the host supports and at least
 * one selected row allows, in order. A row the action does not apply to is
 * skipped and named, so a mixed selection keeps the action and says what it
 * left out rather than hiding it; an action no selected row allows is hidden
 * (a folder-only selection has no Tải xuống, a viewer's has no Lưu trữ).
 */
export function bulkPlans(
  selected: readonly Extract<LibraryRow, { type: "document" }>[],
  actionsOf: (row: LibraryRow) => ReadonlySet<BulkActionId>,
  screen: DocListScreen,
  supports: (action: BulkActionId) => boolean,
  titleOf: (doc: DocumentSummaryRow) => string,
): BulkPlan[] {
  const titles = new Map(selected.map((row) => [row.id, titleOf(row.doc)]));
  return bulkActionsOf(screen)
    .filter(supports)
    .map((action) => {
      const docs: DocumentSummaryRow[] = [];
      const skipped: BulkFailure[] = [];
      for (const row of selected) {
        if (actionsOf(row).has(action)) docs.push(row.doc);
        else skipped.push({ id: row.id, code: skipCode(action, row.doc) });
      }
      return { action, docs, skipped, total: selected.length, titles };
    })
    .filter((plan) => plan.docs.length > 0);
}
