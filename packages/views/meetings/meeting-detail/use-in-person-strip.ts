import { useMeetingCapabilities } from "@uniwork/core/meetings";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import type { Meeting } from "@uniwork/core/types";

/**
 * The strip's in-person inputs (UNI-2247): an in-person meeting opens no room, so its
 * clerk records it instead, and only where the organization can transcribe (spec D5, D6).
 */
export function useInPersonStrip(workspaceId: string, meeting: Meeting | null | undefined, isClerk: boolean) {
  const caps = useMeetingCapabilities(workspaceId);
  const inPerson = meetingVenue(meeting) === "in_person";
  return { inPerson, canRecord: inPerson && isClerk && caps.data?.transcription === true };
}
