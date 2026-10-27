import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { meetingKeys, useMeetingCapabilities } from "@uniwork/core/meetings";
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
 * a clerk has yet to name. An online meeting asks for neither.
 */
export function useInPersonStrip(workspaceId: string, meeting: Meeting | null | undefined, isClerk: boolean) {
  const qc = useQueryClient();
  const caps = useMeetingCapabilities(workspaceId);
  const inPerson = meetingVenue(meeting) === "in_person";
  const after = inPerson && meeting?.status === "ENDED" && meeting.ai_content_readable !== false;
  const meetingId = meeting?.id ?? "";
  const transcriptions = useMeetingTranscriptions(meetingId, after).data;
  const labels = useSpeakerLabels(meetingId, after && isClerk).data;
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
  };
}
