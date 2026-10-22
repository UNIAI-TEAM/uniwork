import { matchesChip, TYPE_CHIPS, type DocumentTypeFilter, type LibraryRow, type TypeChip } from "../library-rows";

// The filter bar's values beyond the type chips (UNI-2045 W10): Người sửa,
// Cập nhật and Gần đây's Tất cả / Đã mở / Đã sửa. Where a list pages on the
// server they become `updated_by`, `updated_from` and `activity`; where it is
// loaded in full (an open folder, Có gắn sao, the files of other modules)
// `matchesMeta` runs the same predicate here.

/** "Người sửa": everyone, the viewer, or one member id. */
export type EditorFilter = "any" | "me" | string;

/** "Cập nhật" buckets; "any" sends no lower bound. */
export const UPDATED_FILTERS = ["any", "today", "7d", "30d"] as const;
export type UpdatedFilter = (typeof UPDATED_FILTERS)[number];

/** Gần đây's segment; "all" sends no `activity`. */
export const ACTIVITY_FILTERS = ["all", "opened", "edited"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

/** The RFC3339 lower bound a Cập nhật bucket stands for; null for "any". */
export function updatedFilterSince(filter: UpdatedFilter, now: number = Date.now()): string | null {
  if (filter === "today") {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return day.toISOString();
  }
  if (filter === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

/** The user id a Người sửa value names, or undefined for "any" (and for "me" before the session is known). */
export function editorFilterId(editor: EditorFilter, userId: string | null): string | undefined {
  if (editor === "any") return undefined;
  return editor === "me" ? (userId ?? undefined) : editor;
}

/**
 * Whether a row passes Người sửa and Cập nhật on the client: a document by
 * its last editor and `updated_at`, a file of another module by its owner and
 * its own `updated_at`.
 */
export function matchesMeta(row: LibraryRow, editorId: string | undefined, since: string | null): boolean {
  const editedBy = row.type === "document" ? row.doc.updated_by : row.source.owner?.id;
  if (editorId && editedBy !== editorId) return false;
  if (!since) return true;
  const updated = Date.parse((row.type === "document" ? row.doc.updated_at : row.source.updated_at) ?? "");
  return !Number.isNaN(updated) && updated >= Date.parse(since);
}

/** Every pickable type, in the menu's order (chips and trigger keep that order, never the order of the clicks). */
export const TYPE_FILTERS: readonly DocumentTypeFilter[] = TYPE_CHIPS.filter((value): value is DocumentTypeFilter => value !== "all");

/**
 * DESIGN-ONLY until the UNI-2113 contract: the one seam between the multi-select
 * Loại filter and the single-valued server parameters (`format=` / `kind=page`).
 * One pick is sent as today; none or several send no type, and `narrowOnClient`
 * tells the library hook to narrow the loaded rows with `matchesTypes`. Step 2
 * replaces this with the real multi-value query and drops the client narrowing.
 */
export function typeFilterQuery(selected: readonly DocumentTypeFilter[]): { chip: TypeChip; narrowOnClient: boolean } {
  if (selected.length === 1) return { chip: selected[0]!, narrowOnClient: false };
  return { chip: "all", narrowOnClient: selected.length > 1 };
}

/** DESIGN-ONLY (see `typeFilterQuery`): a row passes when any picked type does; folders stay visible like `matchesChip`. */
export function matchesTypes(row: LibraryRow, selected: readonly DocumentTypeFilter[]): boolean {
  return selected.length === 0 || selected.some((type) => matchesChip(row, type));
}
