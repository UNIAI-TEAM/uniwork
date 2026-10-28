/** Where a meeting is held: in a room online, or in person with no room (UNI-2247). */
export const MEETING_VENUES = ["online", "in_person"] as const;
export type MeetingVenue = (typeof MEETING_VENUES)[number];

/** The meeting's venue; absent or unknown (an older server, drift) reads as online. */
export function meetingVenue(m: { venue?: string | null } | null | undefined): MeetingVenue {
  return m?.venue === "in_person" ? "in_person" : "online";
}
