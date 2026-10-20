import type { DocumentSummaryRow } from "../library-rows";

// The optional list fields the server agreed for UNI-2045 (SV-1..SV-6, see
// contract "Hình dạng server đã chốt"), read in this one place. The core
// schema does not parse them yet, so a parsed row never carries them and every
// field below reads undefined today; W4-W7 add each to the schema and then
// read it here from the typed row instead of the loose record.

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

export interface DocListRowFields {
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

type Loose = Record<string, unknown>;

const record = (value: unknown): Loose | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The agreed optional fields of one row; a missing or malformed field reads undefined. */
export function docListRowFields(doc: DocumentSummaryRow): DocListRowFields {
  const raw = doc as unknown as Loose;
  const fields: DocListRowFields = {};

  const activity = record(raw.last_activity);
  const activityKind = text(activity?.kind);
  const activityAt = text(activity?.at);
  if (activityKind && activityAt) fields.lastActivity = { kind: activityKind, at: activityAt };

  const favoritedAt = text(raw.favorited_at);
  if (favoritedAt) fields.favoritedAt = favoritedAt;

  const shared = record(raw.shared);
  const sharedBy = text(shared?.by);
  const sharedAt = text(shared?.at);
  if (shared && sharedBy && sharedAt) {
    fields.shared = { by: sharedBy, byKind: text(shared.by_kind) ?? "human", byName: text(shared.by_name) ?? null, at: sharedAt };
  }

  const summary = record(raw.share_summary);
  if (summary) {
    fields.shareSummary = {
      people: count(summary.people),
      workspaces: count(summary.workspaces),
      links: count(summary.links),
      latestAt: text(summary.latest_at) ?? null,
    };
  }

  if (typeof raw.is_owner === "boolean") fields.isOwner = raw.is_owner;

  if (raw.updated_by_user === null) fields.updatedByUser = null;
  else {
    const user = record(raw.updated_by_user);
    const name = text(user?.name);
    if (name) fields.updatedByUser = { name, avatarUrl: text(user?.avatar_url) ?? null };
  }

  return fields;
}
