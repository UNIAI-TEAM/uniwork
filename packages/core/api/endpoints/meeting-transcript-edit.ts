import { z } from "zod";
import { type MeetingTranscriptSegment, TranscriptSegmentSchema } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// A clerk corrects or removes transcript lines, or an uploaded transcription
// with its recording (UNI-1995 #5). Each awaits the server: a deletion is not
// locally predictable (a stretch, sources the reader does not see).

const enc = encodeURIComponent;
const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}`;

/** The corrected line, or null when the answer does not parse. */
export async function editTranscriptSegment(
  meetingId: string,
  segmentId: string,
  text: string,
): Promise<MeetingTranscriptSegment | null> {
  const raw = await request(`${base(meetingId)}/transcript/${enc(segmentId)}`, { method: "PATCH", body: { text } });
  return (
    parseWithFallback<{ segment: MeetingTranscriptSegment } | null>(raw, z.object({ segment: TranscriptSegmentSchema }), null, {
      endpoint: "PATCH /api/v1/meetings/{id}/transcript/{segmentID}",
    })?.segment ?? null
  );
}

export async function deleteTranscriptSegment(meetingId: string, segmentId: string): Promise<void> {
  await request(`${base(meetingId)}/transcript/${enc(segmentId)}`, { method: "DELETE" });
}

/**
 * Deletes the lines spoken in [from, to) (RFC 3339), or every line when no
 * range is given. Returns how many went; 0 when the answer does not parse.
 */
export async function deleteTranscript(meetingId: string, range?: { from: string; to: string }): Promise<number> {
  const qs = range ? `?${new URLSearchParams({ from: range.from, to: range.to }).toString()}` : "";
  const raw = await request(`${base(meetingId)}/transcript${qs}`, { method: "DELETE" });
  return parseWithFallback(raw, z.object({ deleted: z.number() }), { deleted: 0 }, {
    endpoint: "DELETE /api/v1/meetings/{id}/transcript",
  }).deleted;
}

/** An uploaded transcription that is done or failed, its lines and its recording. */
export async function deleteMeetingTranscription(meetingId: string, transcriptionId: string): Promise<void> {
  await request(`${base(meetingId)}/transcriptions/${enc(transcriptionId)}`, { method: "DELETE" });
}
