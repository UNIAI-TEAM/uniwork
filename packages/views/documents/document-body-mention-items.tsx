import type { QueryClient } from "@tanstack/react-query";
import type { MentionItem } from "../editor/extensions/mention-suggestion";
import { CandidateIdentity } from "./document-comment-picker-option";
import { mentionCandidatesQuery } from "./use-mention-picker";

/**
 * The people the body `@` picker offers: the same mention candidates (same
 * endpoint, `include=no_access` rule and search) as the comment picker, each
 * row drawn by the comment picker's `CandidateIdentity`.
 */
export async function fetchBodyMentionItems(
  qc: QueryClient,
  { wsId, documentId, query, includeNoAccess }: { wsId: string; documentId: string; query: string; includeNoAccess: boolean },
): Promise<MentionItem[]> {
  const candidates = await qc.fetchQuery({
    ...mentionCandidatesQuery(wsId, documentId, query.trim(), includeNoAccess),
    staleTime: 15_000,
  });
  return candidates
    .filter((candidate) => includeNoAccess || candidate.can_view !== false)
    .map((candidate) => ({
      id: candidate.user_id,
      label: candidate.display_name || candidate.user_id,
      type: "member" as const,
      content: <CandidateIdentity candidate={candidate} />,
    }));
}
