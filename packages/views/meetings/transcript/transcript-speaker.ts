import type { useTranslation } from "react-i18next";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";

/**
 * The name a transcript line shows. A speaker nobody named yet is worded here,
 * in the reader's language: the room mic's "Room mic · Speaker n", an uploaded
 * file's plain "Speaker n" (its label key starts with "upload:").
 */
export function transcriptSpeaker(s: MeetingTranscriptSegment, t: ReturnType<typeof useTranslation>["t"]): string {
  const upload = s.speaker_label?.startsWith("upload:") === true;
  if (s.room_speaker) return t(upload ? "meetings.fileSpeaker" : "meetings.scribe.speakerLabel", { n: s.room_speaker });
  if (s.speaker_label?.endsWith(":?")) return t(upload ? "meetings.fileSpeakerUnknown" : "meetings.scribe.speakerUnknown");
  return s.speaker_name || "—";
}
