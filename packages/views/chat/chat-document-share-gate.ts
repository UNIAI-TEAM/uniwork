/** The fields of a library list row the gate reads (a wire row: enums arrive as strings). */
export type ChatShareableDocumentRow = {
  kind: string;
  system_kind?: string | null;
  my_level?: string | null;
  admin_scope?: boolean;
  owner_kind?: string | null;
  archived_at?: string | null;
  shelved_at?: string | null;
};

/**
 * Whether the "Đính kèm từ Tài liệu" picker lists a library row. Sending a
 * document into a room grants the room access to it, which only a manager of
 * the document may do — so a row the sender cannot share is not listed at all
 * (UNI-2012 D5): no greyed row, no lock reason.
 *
 * The administer test mirrors canAdministerDocument (packages/core/permissions
 * rules.ts): `admin_scope` or level `manage`, from the row the list route
 * already carries. The rest are the rows the share dialog itself refuses
 * (document-actions-menu.tsx): folders and the My Folder system row, an owned
 * (work-product) document whose access its task or meeting delegates, and
 * archived or shelved ones. A `page` is a document and is allowed.
 */
export function canShareDocumentForChat(row: ChatShareableDocumentRow): boolean {
  if (row.kind === "folder" || row.system_kind === "my_folder") return false;
  if (row.owner_kind) return false;
  if (row.archived_at || row.shelved_at) return false;
  return row.admin_scope === true || row.my_level === "manage";
}
