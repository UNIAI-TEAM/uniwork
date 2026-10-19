"use client";

import { useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { collectUserMentions } from "@uniwork/core/documents/schema";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { listDocumentMentionCandidates } from "@uniwork/core/api/endpoints/document-comments";
import type { MentionCandidate } from "@uniwork/core/types/document-access";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";

export type BodyMentionTarget = DocumentCommentMentionWithoutAccess;

/** One newly saved mention still waiting on its candidates answer. */
interface PendingMention {
  id: string;
  /** The mention node's label — the `q` that scopes the lookup. */
  label: string;
}

/** One resolved no-access person the hint names until it closes. */
interface BlockedMention extends PendingMention {
  /** The candidates row that proved `can_view === false`, kept so a refetch can drop it. */
  row: MentionCandidate;
}

/** At most this many new mentions are resolved per acknowledged save (RFM-01 review). */
const MAX_RESOLVE_PER_SAVE = 10;

/** Module-level combine: keeps useQueries' result identity stable across renders. */
function pickCandidates(results: readonly UseQueryResult<MentionCandidate[]>[]) {
  return results.map((r) => r.data);
}

/**
 * Post-save no-access hint (UNI-1968 W2, RFM-01/RFM-03): after an
 * acknowledged body save, people newly mentioned in the page who cannot view
 * it never got the `document_body_mentioned` row — the server only notifies
 * viewers. This diff watches the save machine's `acked` document, collects
 * the mentions the acknowledged body added over every earlier known body
 * (the open document at mount, then each acknowledged save), and resolves
 * each new id against the candidates endpoint on its own — `q` is the
 * mention's label, `include=no_access` — because the unfiltered candidates
 * page sorts viewers first and drops every no-access row past 50.
 *
 * No candidates request fires on open or on a save that adds nobody: the
 * only queries this hook mounts are the pending and the blocked lookups, and
 * an id absent from its own answer is unknown, never hinted. Each blocked id
 * keeps its lookup mounted, so the share invalidation refetches it and a
 * `can_view` flip drops the name without waiting for the notice to close.
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
  const [pending, setPending] = useState<PendingMention[]>([]);
  const [blocked, setBlocked] = useState<BlockedMention[]>([]);

  const candidates = (label: string, enabled = true) => ({
    queryKey: [...documentKeys.mentionCandidates(wsId, documentId, label, 50), "no_access"] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      listDocumentMentionCandidates(documentId, { q: label, include: "no_access", limit: 50 }, signal),
    // The pending lookup mounts before the blocked one: without a staleTime
    // the blocked observer would refetch the fresh answer it just resolved.
    // Invalidation still refetches it — a just-shared person reads fresh.
    staleTime: 60_000,
    enabled: enabled && Boolean(wsId) && Boolean(documentId),
  });

  // The pending lookups: one candidates request per newly added id, scoped to
  // its label so the row is in the answer however many people can view. A
  // mention saved without a label cannot name a `q`; it never resolves —
  // treated as unknown, never hinted.
  const pendingData = useQueries({
    queries: pending.map((m) => candidates(m.label, m.label !== "")),
    combine: pickCandidates,
  });

  // The blocked ids keep their lookups mounted: an invalidation after a share
  // refetches them and a flipped can_view is dropped below without waiting
  // for the notice to close.
  const blockedData = useQueries({
    queries: blocked.map((m) => candidates(m.label)),
    combine: pickCandidates,
  });

  // Collect the newly mentioned ids once per acknowledged save. The editor
  // themself never becomes pending — their own mention needs no lookup, let
  // alone a hint — and neither does an id already awaiting or holding one,
  // which a remove/re-add inside the pending window would otherwise queue
  // twice.
  useEffect(() => {
    const acked = state.acked;
    if (state.phase !== "saved" || !acked || processedAckedRef.current === acked) return;
    processedAckedRef.current = acked;
    const pendingIds = new Set([...pending.map((m) => m.id), ...blocked.map((m) => m.id)]);
    const current = collectUserMentions(acked.content);
    const added: PendingMention[] = [];
    for (const [id, label] of current) {
      if (knownRef.current.has(id) || pendingIds.has(id) || id === userId) continue;
      added.push({ id, label });
      if (added.length >= MAX_RESOLVE_PER_SAVE) break;
    }
    knownRef.current = new Set(current.keys());
    if (added.length > 0) setPending((prev) => [...prev, ...added]);
  }, [state, userId, pending, blocked]);

  // Known baseline, once: the body the page opened with.
  useEffect(() => {
    knownRef.current = new Set(collectUserMentions(baseContent).keys());
    processedAckedRef.current = state.acked;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount baseline only
  }, []);

  // Evaluate pending ids once each one's own answer is in — the effect waits
  // on every labeled lookup. can_view === false is the only access proof; a
  // missing row (task/project mention, a member who left, a name page cut at
  // 50) is unknown and gets no hint.
  useEffect(() => {
    if (pending.length === 0) return;
    if (!pending.every((m, i) => m.label === "" || pendingData[i] !== undefined)) return;
    const next: BlockedMention[] = [];
    for (let i = 0; i < pending.length; i += 1) {
      const m = pending[i]!;
      if (m.label === "") continue;
      const row = pendingData[i]?.find((c) => c.user_id === m.id);
      if (row !== undefined && row.can_view === false) next.push({ ...m, row });
    }
    if (next.length > 0) setBlocked((prev) => [...prev, ...next]);
    setPending([]);
  }, [pending, pendingData]);

  // Live rows: a mounted blocked lookup's latest row for the id, or the row
  // it resolved with while that refetch lands.
  const liveRows = new Map<string, MentionCandidate>();
  for (let i = 0; i < blocked.length; i += 1) {
    const m = blocked[i]!;
    liveRows.set(m.id, blockedData[i]?.find((c) => c.user_id === m.id) ?? m.row);
  }

  // Live targets: the blocked ids whose latest answer still reports
  // can_view === false — a share in flight that flipped it drops the name
  // here without waiting for the next save. The editor is never hinted for
  // mentioning themself.
  const targets: BodyMentionTarget[] = blocked
    .map((m) => liveRows.get(m.id))
    .filter((c): c is MentionCandidate => c !== undefined && c.can_view === false && c.user_id !== userId)
    .map((c) => ({ user_id: c.user_id, display_name: c.display_name, can_share: true }));

  /** Drop the blocked ids the refetched lookup no longer reports — sharing
   *  on another screen counts too — without waiting for the notice to close. */
  useEffect(() => {
    if (blocked.length === 0) return;
    const still = blocked.filter((m, i) => {
      const data = blockedData[i];
      if (data === undefined) return true; // in flight: keep the resolved row
      const row = data.find((c) => c.user_id === m.id);
      return row !== undefined && row.can_view === false;
    });
    if (still.length === blocked.length && still.every((m, i) => m === blocked[i])) return;
    setBlocked(still);
  }, [blocked, blockedData]);

  /** The dismissed hint stays dismissed: the ids are already `known`, so a
   *  later save of unchanged content never re-prompts. */
  const dismiss = () => setBlocked([]);

  /** After a share attempt the candidates lookups are stale — invalidate the
   *  document's mention-candidates branch so the mounted ones refetch and a
   *  later mention resolves fresh. */
  const refreshAfterShare = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...documentKeys.detail(wsId, documentId), "mention-candidates"],
    });
  };

  return { targets, dismiss, refreshAfterShare };
}
