"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentLink,
  getDocumentShares,
  revokeDocumentLink,
  updateDocumentAccess,
  type DocumentAccessOnExisting,
  type DocumentAccessUpdateItemInput,
  type DocumentPrincipalType,
} from "../api/endpoints/documents-sharing";
import { DocumentNotVerifiableError, type DocumentAccessLevel } from "../types/document";
import { runBulk, type BulkResult } from "./bulk";
import { documentKeys } from "./keys";

// Sharing several documents at once (UNI-2045 W13). There is no multi-document
// share route: each document gets the calls its own share dialog makes, so
// the server checks, audits and rate-limits every document on its own.

/** What happens to each document's public links. */
export type BulkShareLink = "keep" | "create" | "revoke";

/** The home workspace row: unchanged, a level, or no workspace access. */
export type BulkShareWorkspace = "keep" | "none" | Extract<DocumentAccessLevel, "view" | "comment" | "edit">;

export interface BulkSharePerson {
  principal_type: DocumentPrincipalType;
  principal_id: string;
  level: DocumentAccessLevel;
}

export interface BulkShareInput {
  /** The documents to share; `workspace_id` is each one's own home workspace. */
  docs: readonly { id: string; workspace_id: string }[];
  /** The same people, workspaces or organization for every document. */
  people: readonly BulkSharePerson[];
  /** A picked principal that already has a direct grant: keep it (the single dialog's default) or move it to the new level. */
  onExisting: DocumentAccessOnExisting;
  workspace: BulkShareWorkspace;
  link: BulkShareLink;
  /** Days a created link lives (1-90). */
  expiresInDays?: number;
}

export interface BulkShareResult extends BulkResult {
  /** The one-time URL of each created link, in the order the documents were given. */
  links: { id: string; url: string }[];
}

function accessItems(input: BulkShareInput, workspaceId: string): DocumentAccessUpdateItemInput[] {
  const items: DocumentAccessUpdateItemInput[] = input.people.map((person) => ({ ...person, on_existing: input.onExisting }));
  if (input.workspace === "none") items.push({ principal_type: "workspace", principal_id: workspaceId, level: null });
  else if (input.workspace !== "keep") items.push({ principal_type: "workspace", principal_id: workspaceId, level: input.workspace, on_existing: "update" });
  return items;
}

async function shareOne(input: BulkShareInput, doc: { id: string; workspace_id: string }, links: Map<string, string>): Promise<void> {
  const items = accessItems(input, doc.workspace_id);
  if (items.length > 0 && !(await updateDocumentAccess(doc.id, { items, dry_run: false }))) throw new DocumentNotVerifiableError();
  if (input.link === "create") {
    const envelope = await createDocumentLink(doc.id, input.expiresInDays);
    if (!envelope?.url) throw new DocumentNotVerifiableError();
    links.set(doc.id, envelope.url);
  } else if (input.link === "revoke") {
    const access = await getDocumentShares(doc.id);
    if (!access) throw new DocumentNotVerifiableError();
    for (const link of access.links ?? []) await revokeDocumentLink(doc.id, link.id);
  }
}

/** Shares many documents the same way; resolves `{ok, failed, links}` (it never rejects) and invalidates the workspace document root once. */
export function useBulkShareDocuments(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkShareInput): Promise<BulkShareResult> => {
      const byId = new Map(input.docs.map((doc) => [doc.id, doc]));
      const links = new Map<string, string>();
      const result = await runBulk([...byId.keys()], (id) => shareOne(input, byId.get(id)!, links));
      return { ...result, links: result.ok.flatMap((id) => (links.has(id) ? [{ id, url: links.get(id)! }] : [])) };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) }),
  });
}
