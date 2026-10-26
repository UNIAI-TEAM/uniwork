"use client";
import { createContext, useContext } from "react";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import type { useMemberIndex } from "../use-member-index";
import type { DetailStatus, DetailTab, DetailViewer, SectionFlags } from "./detail-model";

/**
 * What every slot of the meeting detail page reads instead of drilled props
 * (PLAN §1.4). `MeetingDetailView` (package A) builds the value with the pure
 * rules in `detail-model.ts` and provides it; slots call `useDetail()`.
 */
export type DetailContextValue = {
  workspaceId: string;
  meeting: Meeting;
  /** `displayMeetingStatus(meeting, now)`: OVERTIME and MISSED come from the clock. */
  displayStatus: DetailStatus;
  /** `useNow()`; pass it on to the time helpers in `format.ts`. */
  now: number;
  viewer: DetailViewer;
  canHost: boolean;
  /** Host, secretary or workspace admin (`useMeetingClerk`). */
  isClerk: boolean;
  /** `meeting.ai_content_readable !== false`. */
  aiReadable: boolean;
  layout: "page" | "panel";
  /** Content narrower than 600: the phone frame (PLAN D10). */
  isPhone: boolean;
  memberIndex: ReturnType<typeof useMemberIndex>;
  /** Active participants. */
  participants: MeetingParticipant[];
  invitations: MeetingInvitation[];
  sections: SectionFlags;
  tabs: {
    list: DetailTab[];
    /** null when the page has no tabs (scheduled, missed, canceled, outsider). */
    current: DetailTab | null;
    set: (tab: DetailTab) => void;
    /** The minutes' finalize confirm the strip asked for: `?finalize=1` on the page, state in the calendar panel. */
    finalize?: { open: boolean; close: () => void };
    /** The overview tab scrolled to the action items (the strip's "Rà và giao"). */
    review?: () => void;
  };
  /** The live roll drawer, opened from the rail's "Điểm danh"; the page reads it to make room for the docked drawer. */
  roll: { open: boolean; setOpen: (open: boolean) => void };
};

export const DetailContext = createContext<DetailContextValue | null>(null);

export function useDetail(): DetailContextValue {
  const value = useContext(DetailContext);
  if (!value) throw new Error("useDetail() needs a <DetailContext.Provider> (MeetingDetailView provides it)");
  return value;
}
