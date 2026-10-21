import type { DocumentSummaryRow } from "../library-rows";

// The optional list fields the server agreed for UNI-2045 (SV-1..SV-6, see
// contract "Hình dạng server đã chốt"), read in this one place. The core
// schema parses each leniently (a drifted block is absent), and a server that
// does not send one yet leaves it undefined here too.

export interface DocListLastActivity {
  kind: string;
  at: string;
}

export interface DocListSharedBy {
  by: string;
  byKind: string;
  byName: string | null;
  at: string;
}

export interface DocListShareSummary {
  people: number;
  workspaces: number;
  links: number;
  latestAt: string | null;
}

/** Who moved a row to the trash and when; `by` is null for the system. */
export interface DocListTrashed {
  by: string | null;
  at: string;
  /** When the server purges it (30 days on); null when the answer did not say. */
  purgeAfter: string | null;
}

/** Who shelved a row (Lưu trữ) and when; `by` is null for the system. */
export interface DocListShelved {
  by: string | null;
  at: string;
}

export interface DocListRowFields {
  /** Thùng rác: the archive stamp every list row already carries. */
  trashed?: DocListTrashed;
  /** Lưu trữ: the shelve stamp every list row already carries. */
  shelved?: DocListShelved;
  /** SV-1, Recent. */
  lastActivity?: DocListLastActivity;
  /** SV-2, Starred. */
  favoritedAt?: string;
  /** SV-3, Shared with me. */
  shared?: DocListSharedBy;
  /** SV-4, Shared by me. */
  shareSummary?: DocListShareSummary;
  /** SV-5, every list. */
  isOwner?: boolean;
  /** SV-6, every list; null when the editor is outside the caller's organization. */
  updatedByUser?: { name: string; avatarUrl: string | null } | null;
}

const text = (value: string | null | undefined): string | undefined => (value ? value : undefined);

/** The agreed optional fields of one row; a missing or malformed field reads undefined. */
export function docListRowFields(doc: DocumentSummaryRow): DocListRowFields {
  const fields: DocListRowFields = {};

  if (doc.archived_at) {
    fields.trashed = { by: doc.archived_by || null, at: doc.archived_at, purgeAfter: doc.purge_after || null };
  }
  const shelvedAt = text(doc.shelved_at);
  if (shelvedAt) fields.shelved = { by: text(doc.shelved_by) ?? null, at: shelvedAt };

  const activity = doc.last_activity;
  if (activity?.kind && activity.at) fields.lastActivity = { kind: activity.kind, at: activity.at };

  const favoritedAt = text(doc.favorited_at);
  if (favoritedAt) fields.favoritedAt = favoritedAt;

  const shared = doc.shared;
  if (shared?.by && shared.at) {
    fields.shared = { by: shared.by, byKind: text(shared.by_kind) ?? "human", byName: text(shared.by_name) ?? null, at: shared.at };
  }

  const summary = doc.share_summary;
  if (summary) {
    fields.shareSummary = { people: summary.people, workspaces: summary.workspaces, links: summary.links, latestAt: text(summary.latest_at) ?? null };
  }

  if (typeof doc.is_owner === "boolean") fields.isOwner = doc.is_owner;

  if (doc.updated_by_user === null) fields.updatedByUser = null;
  else if (doc.updated_by_user?.name) {
    fields.updatedByUser = { name: doc.updated_by_user.name, avatarUrl: text(doc.updated_by_user.avatar_url) ?? null };
  }

  return fields;
}
