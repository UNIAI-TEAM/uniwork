import type { DocumentAdminScopeFake } from "@uniwork/core/documents/doc05-fake";
import type { Document, DocumentAccessLevel } from "@uniwork/core/types/document";

/**
 * What the share dialog reads of a document (access addendum §2.5, N-01).
 * A live `Document` satisfies it, and so does the locked card's target built
 * from the admin-summary read, where a pure admin has `my_level: ""` and
 * `admin_scope: true` — so the dialog never needs the document body.
 * `title` is optional: only the owner-transfer heading reads it.
 */
export type ShareDialogTarget = Pick<
  Document,
  "id" | "visibility" | "owner_kind" | "organization_id" | "revision" | "archived_at"
> & {
  my_level?: DocumentAccessLevel | "";
  title?: string;
} & DocumentAdminScopeFake;
