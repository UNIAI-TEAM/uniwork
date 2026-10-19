import type { Document, DocumentAccessLevel } from "@uniwork/core/types/document";

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
