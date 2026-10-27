import { useMeetingCapabilities } from "@uniwork/core/meetings";
import { useSpeakerLabels } from "@uniwork/core/meetings/speaker-labels";
import { useMeetingTranscriptions } from "@uniwork/core/meetings/transcriptions";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import type { Meeting } from "@uniwork/core/types";
import { transcribingOf } from "./next-step-jobs";

/**
 * The strip's in-person inputs (UNI-2247): an in-person meeting opens no room, so its
 * clerk records it instead, and only where the organization can transcribe (spec D5, D6).
 * Once it ended: whether its recording is still being transcribed, and how many speakers
 * a clerk has yet to name. An online meeting asks for neither.
 */
export function useInPersonStrip(workspaceId: string, meeting: Meeting | null | undefined, isClerk: boolean) {
  const caps = useMeetingCapabilities(workspaceId);
  const inPerson = meetingVenue(meeting) === "in_person";
  const after = inPerson && meeting?.status === "ENDED" && meeting.ai_content_readable !== false;
  const meetingId = meeting?.id ?? "";
  const transcriptions = useMeetingTranscriptions(meetingId, after).data;
  const labels = useSpeakerLabels(meetingId, after && isClerk).data;
  return {
    inPerson,
    canRecord: inPerson && isClerk && caps.data?.transcription === true,
    transcribing: after ? transcribingOf(transcriptions) : null,
    unnamedSpeakers: after && isClerk ? (labels ?? []).filter((l) => !l.user_id && !l.name && !l.assigned_name).length : 0,
  };
}
