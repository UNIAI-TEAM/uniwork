/**
 * What a list row lets the viewer do, read from the level the server put on
 * the row (`my_level`, the same effectiveLevel the detail route answers
 * with). A row with no level — an older server, or a starred row with no
 * loaded copy — reads as view: the controls stay hidden rather than offer a
 * command the server would refuse.
 */
type RowLevel = "view" | "edit" | "manage";

export function rowLevel(row: { my_level?: string | null } | null | undefined): RowLevel {
  switch (row?.my_level) {
    case "edit":
    case "manage":
      return row.my_level;
    default:
      return "view";
  }
}

/** Move needs edit on the row (DocumentService.MoveDocument). */
export function canMoveRow(level: RowLevel): boolean {
  return level !== "view";
}

/** Archive needs manage on the row (DocumentService.ArchiveDocument). */
export function canArchiveRow(level: RowLevel): boolean {
  return level === "manage";
}

/** The desktop app session a row opens: read-only unless the viewer can edit. */
export function rowAppOperation(level: RowLevel): "view" | "edit" {
  return level === "view" ? "view" : "edit";
}
