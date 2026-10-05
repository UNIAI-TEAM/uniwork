"use client";

import { useMemo, useState } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import { RoomEvent, type Participant } from "livekit-client";
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
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";
import { meetingLocale } from "./meeting-datetime";
import { MeetingDutyMenuItems, dutyRole } from "./meeting-duty-menu-items";
import { MeetingJoinRequestsSection } from "./meeting-join-requests-section";
import { MeetingMuteAllButton } from "./meeting-moderation";
import { MeetingParticipantRow } from "./meeting-participant-row";
import { useRoomAvatarOf } from "./meeting-room-avatars";
import { guestIdentities, PARTICIPANT_IDENTITY_PREFIX, participantRole } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";
import { MEETING_TOGGLE_CHIP } from "./meeting-toggle-chip";
import { useWindowedList } from "./use-windowed-list";

/** The pressed view lifts out of the track: the meeting list's filter chip, stretched to half the track. */
const SEGMENT = `${MEETING_TOGGLE_CHIP} w-full rounded-lg hover:bg-transparent`;

/**
 * Joins and leaves are always followed; a rename is the one other change the
 * list shows. Each row follows its own mic, speaking and lock state.
 */
const ROSTER_EVENTS = [RoomEvent.ParticipantNameChanged];

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

/** One collator per locale for the room's life: building one per comparison is what made sorting slow. */
const collators = new Map<string, Intl.Collator>();
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { sensitivity: "base" });
    collators.set(locale, collator);
  }
  return collator;
}

function orderParticipants(
  participants: readonly Participant[],
  hands: readonly string[],
  pinnedIdentity: string | null,
  collator: Intl.Collator,
): Participant[] {
  const handIndex = new Map(hands.map((identity, i) => [identity, i]));
  const rank = (p: Participant): number => {
    if (pinnedIdentity && p.identity === pinnedIdentity) return -1;
    const hand = handIndex.get(p.identity);
    if (hand !== undefined) return hand;
    if (p.isLocal) return 1_000_000;
    return 500_000;
  };
  return participants
    .map((p) => ({ p, rank: rank(p), name: displayName(p) }))
    .sort((a, b) => a.rank - b.rank || collator.compare(a.name, b.name))
    .map((x) => x.p);
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
  const { t, i18n } = useTranslation();
  const liveParticipants = useLiveKitParticipants({ updateOnlyOn: ROSTER_EVENTS });
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
  const locale = meetingLocale(i18n.language);
  // Sorted once per roster, hand or pin change, not on every keystroke or render.
  const ordered = useMemo(
    () => orderParticipants(liveParticipants, hands, pinnedIdentity, collatorFor(locale)),
    [liveParticipants, hands, pinnedIdentity, locale],
  );
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? ordered.filter((p) => displayName(p).toLowerCase().includes(needle)) : ordered),
    [ordered, needle],
  );
  const list = useWindowedList(filtered.length);

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
          {/* Host only (the moderation context says so); a guest host link never gets it. */}
          {!guestMode && liveParticipants.length > 1 ? <MeetingMuteAllButton className="mb-3 shrink-0" /> : null}

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

            <CollapsibleContent ref={list.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-caption text-muted-foreground">
                  {needle ? t("meetings.noPeopleMatch") : t("meetings.noParticipantsYet")}
                </p>
              ) : (
                // A long room mounts only the rows near the viewport; each row
                // keeps its place in the whole list for assistive tech.
                <ul
                  className="pb-2"
                  style={list.windowed ? { paddingTop: list.window.padTop, paddingBottom: list.window.padBottom } : undefined}
                >
                  {filtered.slice(list.window.start, list.window.end).map((participant, i) => {
                    const meta = participantMeta.get(participant.identity);
                    const index = list.window.start + i;
                    return (
                      <li
                        key={participant.identity}
                        // Spacing inside the row, so the row measured is the row repeated.
                        className="pb-0.5"
                        ref={i === 0 ? list.measureRow : undefined}
                        aria-setsize={list.windowed ? filtered.length : undefined}
                        aria-posinset={list.windowed ? index + 1 : undefined}
                      >
                        <MeetingParticipantRow
                          participant={participant}
                          subtitle={rowSubtitle(participant)}
                          // The guest chip wins: a guest is an observer unless promoted.
                          roleChip={participantRole(participant, guests) ?? dutyRole(meta?.api)}
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
