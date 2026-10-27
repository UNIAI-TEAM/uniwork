import type {
  DocumentAccessRejectedCode,
  DocumentShareCandidate,
} from "@uniwork/core/api/endpoints/documents-sharing";
import type {
  FolderContentsAccessItem,
  FolderContentsAccessMode,
  FolderContentsAccessPreview,
  FolderContentsAccessWarning,
} from "@uniwork/core/api/endpoints/documents-folder-contents-access";
import type { DocumentAccessLevel } from "@uniwork/core/types/document";
import { allowedLevelsForPrincipal } from "./share-add-section";

// Pure model of the folder contents access dialog (UNI-2244): what the form
// sends, and what the dry-run summary says. The dialog and the summary only
// draw it.

/** One person, workspace or organization the person picked, with its own level. */
export interface PickedPrincipal {
  key: string;
  candidate: DocumentShareCandidate;
  level: DocumentAccessLevel;
}

/** The workspace root row of the replace mode: `none` leaves it out, which makes the documents Private. */
export type WorkspaceRowLevel = "none" | "view" | "comment" | "edit";

export const WORKSPACE_ROW_LEVELS: readonly WorkspaceRowLevel[] = ["none", "view", "comment", "edit"];

/** What a dry run asked and answered, kept so Apply sends the very items the summary describes. */
export interface FolderAccessSummary {
  mode: FolderContentsAccessMode;
  items: FolderContentsAccessItem[];
  total: number;
  preview: FolderContentsAccessPreview;
}

export function principalKey(principalType: string, principalId: string): string {
  return `${principalType}:${principalId}`;
}

/** The level a picked principal is written with: one its type cannot take falls back to Edit, as the share dialog does. */
export function effectiveLevel(picked: PickedPrincipal): DocumentAccessLevel {
  const allowed = allowedLevelsForPrincipal(picked.candidate.principal_type, picked.candidate.is_home_workspace);
  return allowed.includes(picked.level) ? picked.level : "edit";
}

/**
 * The request items, in the order the server indexes a rejection by: the
 * picked principals, then the workspace root row. The row exists only in
 * replace mode, and `none` leaves it out (the server reads a missing row as
 * Private).
 */
export function buildItems(
  mode: FolderContentsAccessMode,
  picked: readonly PickedPrincipal[],
  workspaceId: string,
  workspaceLevel: WorkspaceRowLevel,
): FolderContentsAccessItem[] {
  const items: FolderContentsAccessItem[] = picked.map((p) => ({
    principal_type: p.candidate.principal_type,
    principal_id: p.candidate.principal_id,
    level: effectiveLevel(p),
  }));
  if (mode === "replace" && workspaceLevel !== "none" && workspaceId) {
    items.push({ principal_type: "workspace", principal_id: workspaceId, level: workspaceLevel });
  }
  return items;
}

const WARNING_ORDER: readonly FolderContentsAccessWarning[] = ["wide_scope", "to_private", "downgrade"];

/** The warnings the dialog knows how to say, in one stable order. */
export function knownWarnings(preview: FolderContentsAccessPreview): FolderContentsAccessWarning[] {
  return WARNING_ORDER.filter((code) => preview.warnings.includes(code));
}

/** Rows a 422 document_access_rejected marked, keyed like the picked principals. */
export function rejectedKeys(
  items: readonly FolderContentsAccessItem[],
  rejected: ReadonlyArray<{ index: number; principal_type: string; principal_id: string; code: DocumentAccessRejectedCode }>,
): Record<string, DocumentAccessRejectedCode> {
  const marks: Record<string, DocumentAccessRejectedCode> = {};
  for (const r of rejected) {
    const item = items[r.index];
    marks[item ? principalKey(item.principal_type, item.principal_id) : principalKey(r.principal_type, r.principal_id)] = r.code;
  }
  return marks;
}
