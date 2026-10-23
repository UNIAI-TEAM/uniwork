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
 * Deletes the lines from one line to another, both included (the server
 * reads their exact times), or every line when no range is given. Returns
 * how many went; null when the answer does not parse.
 */
export async function deleteTranscript(
  meetingId: string,
  range?: { fromSegmentId: string; toSegmentId: string },
): Promise<number | null> {
  const qs = range
    ? `?${new URLSearchParams({ from_segment_id: range.fromSegmentId, to_segment_id: range.toSegmentId }).toString()}`
    : "";
  const raw = await request(`${base(meetingId)}/transcript${qs}`, { method: "DELETE" });
  return parseWithFallback<{ deleted: number | null }>(raw, z.object({ deleted: z.number() }), { deleted: null }, {
    endpoint: "DELETE /api/v1/meetings/{id}/transcript",
  }).deleted;
}

/** An uploaded transcription that is done or failed, its lines and its recording. */
export async function deleteMeetingTranscription(meetingId: string, transcriptionId: string): Promise<void> {
  await request(`${base(meetingId)}/transcriptions/${enc(transcriptionId)}`, { method: "DELETE" });
}
