import { DOCUMENT_ACCESS_LEVELS, type Document, type DocumentAccessLevel } from "@uniwork/core/types/document";
import type { DocumentSummaryRow } from "./library-rows";

/**
 * What the share dialog reads of a document (access addendum §2.5, N-01).
 * A live `Document` satisfies it, and so does the locked card's target built
 * from the admin-summary read, where a pure admin has `my_level: ""` and
 * `admin_scope: true` — so the dialog never needs the document body.
 * `workspace_id` is the document's own workspace, which can differ from the
 * route's (a shared-with-me row opens by id from any workspace): the picker's
 * home row and the merged-share check follow it, never the route.
 * `title` is optional: only the owner-transfer heading reads it. `revision`
 * is optional too: the summary does not carry it, and only the visibility
 * editor needs it.
 */
export type ShareDialogTarget = Pick<
  Document,
  "id" | "workspace_id" | "visibility" | "owner_kind" | "organization_id" | "archived_at" | "shelved_at"
> & {
  my_level?: DocumentAccessLevel | "";
  title?: string;
  revision?: string;
  admin_scope?: boolean;
};

/**
 * A list row is the dialog's target: the summary carries every field it reads,
 * with `my_level` and `admin_scope` as the row's own. The wire strings narrow
 * the way the detail read does: an unknown visibility reads as the default
 * workspace one, an unknown level as none, and any owner is the work product.
 */
export function rowShareTarget(row: DocumentSummaryRow): ShareDialogTarget {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    organization_id: row.organization_id,
    visibility: row.visibility === "restricted" ? "restricted" : "workspace",
    owner_kind: row.owner_kind ? "work_product" : null,
    archived_at: row.archived_at,
    shelved_at: row.shelved_at,
    my_level: DOCUMENT_ACCESS_LEVELS.find((level) => level === row.my_level) ?? "",
    title: row.title,
    revision: row.revision,
    admin_scope: row.admin_scope,
  };
}
