"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { collectUserMentionIds } from "@uniwork/core/documents/schema";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { listDocumentMentionCandidates } from "@uniwork/core/api/endpoints/document-comments";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";

export type BodyMentionTarget = DocumentCommentMentionWithoutAccess;

/**
 * Post-save no-access hint (UNI-1968 W2): after an acknowledged body save,
 * people newly mentioned in the page who cannot view it never got the
 * `document_body_mentioned` row — the server only notifies viewers. This
 * diff watches the save machine's `acked` document, collects the mention ids
 * that the acknowledged body added over every earlier known body (the open
 * document at mount, then each acknowledged save), and keeps the no-access
 * subset — rows the candidates endpoint answers with `can_view === false`,
 * minus the editor themself — until the notice shares or dismisses them.
 *
 * "New" is per acknowledged body, not per user edit: a mention already saved
 * is never re-prompted, even if it left and came back inside one debounced
 * save — the server notified them in the same diff, so prompting again would
 * be noise. Re-adding after a removal that WAS saved prompts again.
 */
export function useBodyMentionHint({
  wsId,
  documentId,
  state,
  baseContent,
}: {
  wsId: string;
  documentId: string;
  /** The document save machine's live state (`save.state`). */
  state: DocumentSaveState;
  /** The body the page opened with — the baseline "known" mentions. */
  baseContent: unknown;
}) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // The mention ids of the last processed body (the open document at mount,
  // then each acknowledged save). Removal empties it, so a mention dropped in
  // one save and re-added in the next counts as new again — a real change.
  const knownRef = useRef<Set<string>>(new Set());
  const processedAckedRef = useRef<unknown>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);

  const candidatesQuery = useQuery({
    queryKey: [...documentKeys.mentionCandidates(wsId, documentId, "", 50), "no_access"] as const,
    queryFn: ({ signal }) =>
      listDocumentMentionCandidates(documentId, { include: "no_access", limit: 50 }, signal),
    enabled: Boolean(wsId) && Boolean(documentId),
  });

  // Collect the newly mentioned ids once per acknowledged save.
  useEffect(() => {
    const acked = state.acked;
    if (state.phase !== "saved" || !acked || processedAckedRef.current === acked) return;
    processedAckedRef.current = acked;
    const current = collectUserMentionIds(acked.content);
    const added: string[] = [];
    for (const id of current) {
      if (knownRef.current.has(id)) continue;
      added.push(id);
    }
    knownRef.current = current;
    if (added.length > 0) setPendingIds((prev) => [...prev, ...added]);
  }, [state]);

  // Known baseline, once: the body the page opened with.
  useEffect(() => {
    knownRef.current = collectUserMentionIds(baseContent);
    processedAckedRef.current = state.acked;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount baseline only
  }, []);

  // Evaluate pending ids once the candidate list (viewers + no-access rows)
  // has loaded. can_view === false is the only access proof; a missing row
  // (task/project mention, a member who left) is skipped silently.
  useEffect(() => {
    if (pendingIds.length === 0 || candidatesQuery.data === undefined) return;
    const noAccess = new Set(
      candidatesQuery.data.filter((c) => c.can_view === false).map((c) => c.user_id),
    );
    const blocked = pendingIds.filter((id) => id !== userId && noAccess.has(id));
    if (blocked.length > 0) setBlockedIds((prev) => [...prev, ...blocked]);
    setPendingIds([]);
  }, [pendingIds, candidatesQuery.data, userId]);

  // Live targets: the blocked ids the latest candidate list still reports as
  // unable to view — a share in flight that flipped can_view drops a name here
  // without waiting for the next save.
  const targets: BodyMentionTarget[] =
    candidatesQuery.data === undefined
      ? []
      : blockedIds
          .map((id) => candidatesQuery.data.find((c) => c.user_id === id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined && c.can_view === false)
          .map((c) => ({ user_id: c.user_id, display_name: c.display_name, can_share: true }));

  /** Drop the blocked ids the candidates list no longer reports — sharing on
   *  another screen counts too — without waiting for the notice to close. */
  useEffect(() => {
    if (candidatesQuery.data === undefined || blockedIds.length === 0) return;
    const noAccess = new Set(
      candidatesQuery.data.filter((c) => c.can_view === false).map((c) => c.user_id),
    );
    if (blockedIds.some((id) => !noAccess.has(id))) {
      setBlockedIds((prev) => prev.filter((id) => noAccess.has(id)));
    }
  }, [blockedIds, candidatesQuery.data]);

  /** The dismissed hint stays dismissed: the ids are already `known`, so a
   *  later save of unchanged content never re-prompts. */
  const dismiss = () => setBlockedIds([]);

  /** After a share attempt the candidates list is stale — refetch it so the
   *  names that now can view leave the hint. */
  const refreshAfterShare = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...documentKeys.mentionCandidates(wsId, documentId)],
    });
  };

  return { targets, dismiss, refreshAfterShare };
}
