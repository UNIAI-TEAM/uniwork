import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { meetingKeys, useMeetingCapabilities } from "@uniwork/core/meetings";
import { useUnsentRecordings } from "@uniwork/core/meetings/recorder";
import { useSpeakerLabels } from "@uniwork/core/meetings/speaker-labels";
import { useMeetingTranscriptions } from "@uniwork/core/meetings/transcriptions";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import type { Meeting } from "@uniwork/core/types";
import { isUnnamedSpeaker } from "../speaker-label-merge";
import { transcribingOf } from "./next-step-jobs";

/**
 * The strip's in-person inputs (UNI-2247): an in-person meeting opens no room, so its
 * clerk records it instead, and only where the organization can transcribe (spec D5, D6).
 * Once it ended: whether its recording is still being transcribed, and how many speakers
 * a clerk has yet to name. An online meeting asks for neither. Given the viewer's `userId`, also
 * what this account recorded of it and left on this device, which no tab is still writing.
 */
export function useInPersonStrip(workspaceId: string, meeting: Meeting | null | undefined, isClerk: boolean, userId?: string) {
  const qc = useQueryClient();
  const caps = useMeetingCapabilities(workspaceId);
  const inPerson = meetingVenue(meeting) === "in_person";
  const after = inPerson && meeting?.status === "ENDED" && meeting.ai_content_readable !== false;
  const meetingId = meeting?.id ?? "";
  const transcriptions = useMeetingTranscriptions(meetingId, after).data;
  const labels = useSpeakerLabels(meetingId, after && isClerk).data;
  // Without a meeting id the device would answer with every meeting's parts.
  const local = useUnsentRecordings(meeting ? userId : undefined, meetingId);
  const open = after ? transcribingOf(transcriptions) : null;
  // The speakers come with the transcript. When the last part finishes, the cached labels may
  // predate it (no realtime frame), so the transcribing state holds until they are refetched (R28).
  const [wasOpen, setWasOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  if (Boolean(open) !== wasOpen) {
    setWasOpen(Boolean(open));
    if (!open) setHolding(true);
  }
  useEffect(() => {
    if (!holding) return;
    let live = true;
    void qc.invalidateQueries({ queryKey: meetingKeys.speakerLabels(meetingId) }).finally(() => live && setHolding(false));
    return () => {
      live = false;
    };
  }, [holding, qc, meetingId]);
  const held = holding ? { seconds: (transcriptions ?? []).reduce((n, t) => n + (t.status === "FAILED" ? 0 : (t.estimated_seconds ?? 0)), 0), openSeconds: 0 } : null;
  return {
    inPerson,
    canRecord: inPerson && isClerk && caps.data?.transcription === true,
    transcribing: open ?? held,
    unnamedSpeakers: after && isClerk ? (labels ?? []).filter(isUnnamedSpeaker).length : 0,
    unsent: local.savedAt === null ? null : { seconds: local.seconds, savedAt: local.savedAt },
  };
}
