import { meetingKeys } from "../meetings/hooks";

type Keys = (readonly unknown[])[];

/**
 * The keys a transcript frame invalidates; null for any other frame. A
 * speaker label appeared or was assigned, an uploaded recording was queued,
 * transcribed or failed (UNI-2001), or a clerk or the retention sweep changed
 * the transcript (UNI-1995 #5): the labels, every read of the transcript
 * (live and forward), the uploads, and the summary's "changed" mark. Split
 * out of use-realtime-sync (max-lines).
 */
export function transcriptFrameKeys(type: string, payload: Record<string, string>): Keys | null {
  const id = payload.meeting_id;
  switch (type) {
    case "speaker_label.updated":
    case "transcription.requested":
    case "transcription.failed":
      return id
        ? [meetingKeys.speakerLabels(id), meetingKeys.transcript(id), meetingKeys.transcriptRead(id), meetingKeys.transcriptions(id)]
        : [];
    // Completion replaces the live lines and writes the TRANSCRIPTION_COMPLETED timeline row.
    case "transcription.completed":
    case "transcript.changed":
      return id
        ? [
            meetingKeys.speakerLabels(id),
            meetingKeys.transcript(id),
            meetingKeys.transcriptRead(id),
            meetingKeys.transcriptions(id),
            meetingKeys.summary(id),
            ...(type === "transcription.completed" ? [meetingKeys.activity(id)] : []),
          ]
        : [];
    default:
      return null;
  }
}
