import { z } from "zod";
import type { MeetingEvidenceRef } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const SourceSchema = z.object({
  kind: z.string(),
  id: z.string(),
  /** Who said, wrote or sent it. */
  author: z.string().nullish(),
  text: z.string(),
  /** When it was said, written or sent (RFC 3339). */
  at: z.string().nullish(),
});

/** One cited line of a meeting as the reader sees it. */
export type MeetingEvidenceSource = z.infer<typeof SourceSchema>;

/** Lines parsed one by one: an entry that does not parse is dropped, not the list. */
const ItemsSchema = z.array(z.unknown()).transform((raw): MeetingEvidenceSource[] =>
  raw.flatMap((entry) => {
    const parsed = SourceSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }),
);

const EvidenceResponse = z.object({ items: ItemsSchema });

/** The cited lines, in the order asked; a line gone since (or of another meeting) is absent. */
export async function getMeetingEvidence(
  meetingId: string,
  refs: readonly MeetingEvidenceRef[],
): Promise<MeetingEvidenceSource[]> {
  const query = encodeURIComponent(refs.map((r) => `${r.kind}:${r.id}`).join(","));
  const raw = await request(`/api/v1/meetings/${encodeURIComponent(meetingId)}/evidence?refs=${query}`);
  return parseWithFallback(raw, EvidenceResponse, { items: [] }, { endpoint: "getMeetingEvidence" }).items;
}
