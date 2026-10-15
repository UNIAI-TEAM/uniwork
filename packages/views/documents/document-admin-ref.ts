import type { Document } from "@uniwork/core/types/document";
import type { DocumentAdminSummary } from "@uniwork/core/types/document-access";

/**
 * The narrow shape the share dialog and the access log need. A real
 * `Document` satisfies it, and so does the metadata-only admin summary, so an
 * admin who cannot read the content is never given a made-up `Document`
 * (DOC-05, R21 H2). `revision` is absent on the summary: the visibility
 * editor needs it, so it stays hidden for that caller.
 */
export interface DocumentAdminRef {
  id: string;
  organization_id: string;
  visibility: Document["visibility"];
  owner_kind?: Document["owner_kind"];
  my_level?: Document["my_level"];
  admin_scope?: boolean;
  revision?: string;
  /** The summary's archive stamp: an archived document opens no requests section (DOC7-W02). */
  archived_at?: string | null;
  title?: string;
}

/** The admin reference of an admin-only caller, from the summary alone. */
export function adminRefFromSummary(summary: DocumentAdminSummary): DocumentAdminRef {
  return {
    id: summary.document.id,
    organization_id: summary.document.organization_id,
    visibility: summary.document.visibility,
    owner_kind: null,
    my_level: summary.my_level || undefined,
    admin_scope: true,
    archived_at: summary.document.archived_at ?? null,
    title: summary.document.title,
  };
}
