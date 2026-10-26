"use client";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import { useDetail } from "../detail-context";
import { StripLobbyRows } from "./strip-lobby-row";
import { StripDraftLine, StripVoteBlock } from "./strip-vote-block";

/**
 * The live jobs of the next-step strip, in reading order (brief §4.4): the
 * guests at the door (host or admin), the open vote, then each drafted
 * motion (whoever clerks). Drafts also show before the meeting, inactive.
 * Draws nothing when there is none; the wrapper hides when its rows are empty.
 */
export function StripLiveRows() {
  const { meeting, displayStatus, canHost, isClerk, viewer } = useDetail();
  const live = displayStatus === "IN_PROGRESS" || displayStatus === "OVERTIME";
  const upcoming = displayStatus === "SCHEDULED";
  const { data: motions } = useMeetingMotions(meeting.id, (live || upcoming) && viewer !== "outsider");
  const open = live ? motions?.find((m) => m.status === "OPEN") : undefined;
  const drafts = isClerk ? (motions ?? []).filter((m) => m.status === "DRAFT") : [];
  if (!live && drafts.length === 0) return null;
  return (
    <div className="empty:hidden">
      {live && canHost ? <StripLobbyRows /> : null}
      {open ? <StripVoteBlock motion={open} /> : null}
      {drafts.map((draft) => (
        <StripDraftLine key={draft.id} motion={draft} blockedBy={!live ? "notStarted" : open ? "openVote" : null} />
      ))}
    </div>
  );
}
