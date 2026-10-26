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
export function rowAppOperation(rowOrLevel: RowLevel | { my_level?: string | null } | null | undefined): "view" | "edit" {
  const level = typeof rowOrLevel === "string" ? rowOrLevel : rowLevel(rowOrLevel);
  return level === "view" ? "view" : "edit";
}

/**
 * Whether a list row offers Share (the gate of DocumentActionsMenu): any
 * reader opens the dialog, a manager manages and anyone else sees their own
 * level. Owned (work-product) documents inherit access from their task or
 * meeting, a trashed row is the trash view's, My Folder is personal and a
 * folder is never shared (UNI-1974). A row with an empty `organization_id` is
 * a starred favorite whose document no loaded list or detail has answered
 * (favoriteRow): its owner and level are unknown, so it offers nothing.
 */
export function canShareRow(
  doc:
    | { kind: string; organization_id?: string; owner_kind?: string | null; archived_at?: string | null; system_kind?: string | null }
    | null
    | undefined,
): boolean {
  return (
    !!doc &&
    doc.organization_id !== "" &&
    doc.kind !== "folder" &&
    !doc.owner_kind &&
    !doc.archived_at &&
    doc.system_kind !== "my_folder"
  );
}
