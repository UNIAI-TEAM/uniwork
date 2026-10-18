import type { DocumentSummaryRow } from "./library-rows";

/** What a favorite carries: enough to open the document, not its dates. */
export interface FavoriteLike {
  document_id: string;
  workspace_id: string;
  title: string;
  kind: string;
  icon?: string | null;
  parent_id?: string | null;
}

type Known = Partial<DocumentSummaryRow> & { id: string };

function isKnown(value: unknown): value is Known {
  return Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string");
}

/**
 * Every document of the workspace some cached query already answered: list
 * pages (infinite `{ pages: [{ documents }] }`) and document details. Read
 * from the cache only; nothing is fetched for it.
 */
export function knownDocuments(entries: readonly (readonly [unknown, unknown])[]): Map<string, Known> {
  const known = new Map<string, Known>();
  for (const [, data] of entries) {
    const pages = (data as { pages?: unknown } | undefined)?.pages;
    if (Array.isArray(pages)) {
      for (const page of pages) {
        const documents = (page as { documents?: unknown } | undefined)?.documents;
        if (!Array.isArray(documents)) continue;
        for (const doc of documents) if (isKnown(doc) && !known.has(doc.id)) known.set(doc.id, doc);
      }
    } else if (isKnown(data) && typeof (data as { updated_at?: unknown }).updated_at === "string") {
      // A detail is the freshest read of one document.
      known.set(data.id, data);
    }
  }
  return known;
}

/**
 * A starred row: the favorite's identity, with the dates, editor, size and
 * level filled from a loaded copy of the same document when there is one
 * ("—" otherwise, never a guess).
 */
export function favoriteRow(fav: FavoriteLike, known?: Known): DocumentSummaryRow {
  return {
    organization_id: known?.organization_id ?? "",
    visibility: known?.visibility ?? "workspace",
    revision: known?.revision ?? "",
    current_version: known?.current_version ?? 0,
    position: known?.position ?? 0,
    created_by: known?.created_by ?? "",
    created_by_kind: known?.created_by_kind ?? "human",
    updated_by: known?.updated_by ?? "",
    updated_by_kind: known?.updated_by_kind ?? "human",
    created_at: known?.created_at ?? "",
    updated_at: known?.updated_at ?? "",
    size_bytes: known?.size_bytes,
    origin: known?.origin,
    format: known?.format,
    my_level: known?.my_level,
    // Pass through, never invented: a trashed favourite keeps its badge in the
    // Starred view, and an owned one keeps "Bạn: Chủ sở hữu" (SV-1).
    via: known?.via,
    archived_at: known?.archived_at,
    id: fav.document_id,
    system_kind: known?.system_kind,
    workspace_id: fav.workspace_id,
    parent_id: fav.parent_id ?? null,
    kind: fav.kind,
    title: fav.title,
    icon: fav.icon ?? null,
  };
}
