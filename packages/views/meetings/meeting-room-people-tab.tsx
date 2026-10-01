"use client";

import { useMemo, useState } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { ChevronDown, Hand, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import { useParticipants } from "@uniwork/core/meetings";
import { useAttendanceFinalized, useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@uniwork/ui/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { foldedIncludes } from "../common/search-fold";
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";
import { MeetingDutyMenuItems, dutyRole } from "./meeting-duty-menu-items";
import { MeetingJoinRequestsSection } from "./meeting-join-requests-section";
import { MeetingParticipantRow } from "./meeting-participant-row";
import { useRoomAvatarOf } from "./meeting-room-avatars";
import { guestIdentities, PARTICIPANT_IDENTITY_PREFIX, participantRole } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";
import { MEETING_TOGGLE_CHIP } from "./meeting-toggle-chip";

/** The pressed view lifts out of the track: the meeting list's filter chip, stretched to half the track. */
const SEGMENT = `${MEETING_TOGGLE_CHIP} w-full rounded-lg hover:bg-transparent`;

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

function orderParticipants(
  participants: Participant[],
  hands: string[],
  pinnedIdentity: string | null,
): Participant[] {
  const rank = (p: Participant): number => {
    if (pinnedIdentity && p.identity === pinnedIdentity) return -1;
    const handIndex = hands.indexOf(p.identity);
    if (handIndex !== -1) return handIndex;
    if (p.isLocal) return 1_000;
    return 500;
  };
  return [...participants].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)));
}

export function MeetingRoomPeopleTab({
  meetingId,
  meeting,
  workspaceId,
  canHost,
  guestMode,
}: {
  meetingId?: string;
  meeting?: Meeting;
  workspaceId?: string;
  canHost?: boolean;
  guestMode?: boolean;
}) {
  const { t } = useTranslation();
  const liveParticipants = useLiveKitParticipants();
  const { hands } = useMeetingSignals();
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const avatarOf = useRoomAvatarOf();
  const { data: apiParticipants } = useParticipants(meetingId ?? "");
  const [search, setSearch] = useState("");
  const [contributorsOpen, setContributorsOpen] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { isClerk } = useMeetingClerk(guestMode ? null : (meeting ?? null), workspaceId ?? "");
  // Hosts and admins are clerks, so this is the roll the attendance view reads too.
  const rollFinalized = useAttendanceFinalized(meetingId ?? "", Boolean(canHost && !guestMode && meetingId));
  const view = useMeetingViewSessionStore((s) => s.peopleView);
  const setView = useMeetingViewSessionStore((s) => s.setPeopleView);

  const hostUserId = meeting?.host_user_id;
  const excludeUserIds = [
    ...new Set(
      [
        hostUserId,
        ...(apiParticipants ?? [])
          .filter((p) => p.status === "ACTIVE")
          .map((p) => p.user_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const participantMeta = useMemo(() => {
    const byIdentity = new Map<
      string,
      { participantId: string | null; isHost: boolean; userId: string | null; api: MeetingParticipant }
    >();
    for (const p of apiParticipants ?? []) {
      const identity = `${PARTICIPANT_IDENTITY_PREFIX}${p.id}`;
      byIdentity.set(identity, {
        participantId: p.id,
        isHost: p.user_id === hostUserId,
        userId: p.user_id ?? null,
        api: p,
      });
    }
    return byIdentity;
  }, [apiParticipants, hostUserId]);

  const guests = useMemo(() => guestIdentities(apiParticipants ?? []), [apiParticipants]);
  const ordered = orderParticipants(liveParticipants, hands, pinnedIdentity);
  const needle = search.trim();
  // Accent-insensitive, every word: "tuan" finds "Tuấn".
  const filtered = needle ? ordered.filter((p) => foldedIncludes(displayName(p), needle)) : ordered;

  function rowSubtitle(participant: Participant): string | undefined {
    const meta = participantMeta.get(participant.identity);
    if (meta?.isHost) return t("meetings.meetingHost");
    if (participant.isLocal && canHost) return t("meetings.meetingHost");
    if (hands.includes(participant.identity)) return t("meetings.handRaised");
    return undefined;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the view switch: latecomers knock while the roll is being taken. */}
      {canHost && meetingId ? <MeetingJoinRequestsSection meetingId={meetingId} /> : null}
      {isClerk ? (
        <ToggleGroup
          value={[view]}
          onValueChange={(v) => {
            // Pressing the view that is on would clear the group; one view is always shown.
            const next = v[0];
            if (next === "room" || next === "attendance") setView(next);
          }}
          aria-label={t("meetings.governance.viewSwitch")}
          spacing={1}
          className="mb-3 grid w-full shrink-0 grid-cols-2 rounded-xl bg-surface-hover p-1"
        >
          <ToggleGroupItem value="room" className={SEGMENT}>
            {t("meetings.governance.viewRoom")}
          </ToggleGroupItem>
          <ToggleGroupItem value="attendance" className={SEGMENT}>
            {t("meetings.governance.viewAttendance")}
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {/* One search for both views: a long roll needs it as much as the room does. */}
      <InputGroup className="mb-4 h-9 shrink-0 rounded-xl bg-surface-hover">
        <InputGroupAddon align="inline-start">
          <Search aria-hidden className="size-4" />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("meetings.searchPeople")}
          aria-label={t("meetings.searchPeople")}
          className="bg-transparent"
        />
      </InputGroup>
      {isClerk && view === "attendance" && meeting ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MeetingAttendancePanel
            meeting={meeting}
            workspaceId={workspaceId ?? ""}
            canEdit
            density="room"
            query={search}
          />
        </div>
      ) : (
        <>
          {canHost && meetingId && workspaceId && !guestMode ? (
            <Button
              type="button"
              variant="brand"
              className="mb-3 h-9 w-full shrink-0 rounded-xl"
              onClick={() => setInviteOpen(true)}
            >
              <Plus aria-hidden className="size-4" />
              {t("meetings.addPeople")}
            </Button>
          ) : null}

          {hands.length > 0 ? (
            <p className="mb-3 flex shrink-0 items-center gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-label font-medium text-warning-soft-foreground">
              <Hand aria-hidden className="size-3.5 shrink-0" />
              {t("meetings.handsRaised", { count: hands.length })}
            </p>
          ) : null}

          <p className="mb-2 shrink-0 text-overline text-muted-foreground">
            {t("meetings.inTheMeeting")}
          </p>

          <Collapsible open={contributorsOpen} onOpenChange={setContributorsOpen} className="min-h-0 flex-1">
            <CollapsibleTrigger className="mb-2 flex w-full shrink-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-body font-medium text-foreground hover:bg-surface-hover">
              <ChevronDown
                aria-hidden
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-fast motion-reduce:transition-none", !contributorsOpen && "-rotate-90")}
              />
              <span className="min-w-0 flex-1">{t("meetings.contributors")}</span>
              <span className="text-caption tabular-nums text-muted-foreground">{filtered.length}</span>
            </CollapsibleTrigger>

            <CollapsibleContent className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-caption text-muted-foreground">
                  {needle ? t("meetings.noPeopleMatch") : t("meetings.noParticipantsYet")}
                </p>
              ) : (
                <ul className="space-y-0.5 pb-2">
                  {filtered.map((participant) => {
                    const meta = participantMeta.get(participant.identity);
                    return (
                      <li key={participant.identity}>
                        <MeetingParticipantRow
                          participant={participant}
                          subtitle={rowSubtitle(participant)}
                          // Like the detail page: a guest keeps "Guest" and shows its
                          // standing beside it; a plain member carries no chip.
                          roleChip={participantRole(participant, guests)}
                          dutyChip={dutyRole(meta?.api)}
                          avatarUrl={avatarOf(participant.identity)}
                          canHost={canHost}
                          removable={!meta?.isHost}
                          pinned={pinnedIdentity === participant.identity}
                          menuExtra={
                            canHost && !guestMode && meetingId && meta ? (
                              <MeetingDutyMenuItems
                                meetingId={meetingId}
                                participant={meta.api}
                                name={displayName(participant)}
                                separatorBefore
                                rollFinalized={rollFinalized}
                                standingOnly={meta.isHost}
                              />
                            ) : null
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CollapsibleContent>
          </Collapsible>

          {canHost && meetingId && workspaceId && !guestMode ? (
            <AddMeetingParticipantsDialog
              workspaceId={workspaceId}
              meetingId={meetingId}
              excludeUserIds={excludeUserIds}
              open={inviteOpen}
              onOpenChange={setInviteOpen}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
