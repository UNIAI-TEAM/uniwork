"use client";

import { useId, useMemo, useState } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { Hand, Search, UserPlus, UserRoundCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import { useParticipants } from "@uniwork/core/meetings";
import { useAttendanceFinalized, useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { Button } from "@uniwork/ui/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@uniwork/ui/components/ui/input-group";
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";
import { MeetingAttendancePanel } from "./meeting-attendance-panel";
import { meetingLocale } from "./meeting-datetime";
import { MeetingDutyMenuItems, dutyRole } from "./meeting-duty-menu-items";
import { MeetingJoinRequestsSection } from "./meeting-join-requests-section";
import { MeetingMuteAllButton } from "./meeting-moderation";
import { MeetingParticipantRow } from "./meeting-participant-row";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingSharedMicMenuItem } from "./meeting-shared-mic-menu-item";
import { useRoomAvatarOf, useRoomTintOf } from "./meeting-room-avatars";
import {
  guestIdentities,
  humanParticipants,
  PARTICIPANT_IDENTITY_PREFIX,
  participantRole,
  ROSTER_EVENTS,
} from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";
import { useWindowedList } from "./use-windowed-list";

/** The tool row's icon buttons: 36px, the search field's height and radius. */
const TOOL = "size-9 shrink-0 rounded-[11px]";

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
    // You come first after the pin and the raised hands: your own row is the one you look for.
    if (p.isLocal) return 250_000;
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
  const roomParticipants = useLiveKitParticipants({ updateOnlyOn: ROSTER_EVENTS });
  const liveParticipants = useMemo(() => humanParticipants(roomParticipants), [roomParticipants]);
  // The shared-mic entry matters only while the AI scribe listens.
  const scribeInRoom = roomParticipants.some((p) => p.isAgent);
  const { hands, toggleHand } = useMeetingSignals();
  const handsHeadingId = useId();
  const roomHeadingId = useId();
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const avatarOf = useRoomAvatarOf();
  const tintOf = useRoomTintOf();
  const { data: apiParticipants } = useParticipants(meetingId ?? "");
  const [search, setSearch] = useState("");
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

  // The queue in the order hands went up; someone who left drops out of it.
  const raised = useMemo(() => {
    const byIdentity = new Map(liveParticipants.map((p) => [p.identity, p]));
    return hands.flatMap((identity) => byIdentity.get(identity) ?? []);
  }, [liveParticipants, hands]);
  const canInvite = Boolean(canHost && meetingId && workspaceId && !guestMode);
  const rollView = isClerk && view === "attendance" && meeting;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the tools: latecomers knock while the roll is being taken. */}
      {canHost && meetingId ? <MeetingJoinRequestsSection meetingId={meetingId} /> : null}
      <div className="mb-3 flex shrink-0 items-center gap-1">
        {/* One search for both views: a long roll needs it as much as the room does. */}
        <InputGroup className="h-9 min-w-0 flex-1 rounded-[11px] border-transparent bg-surface-hover dark:bg-surface-hover">
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
        {canInvite ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={TOOL}
            aria-label={t("meetings.addPeople")}
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus aria-hidden className="size-4" />
          </Button>
        ) : null}
        {/* Host only (the moderation context says so); a guest host link never gets it. */}
        {!guestMode && liveParticipants.length > 1 ? <MeetingMuteAllButton className="shrink-0" /> : null}
        {isClerk ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`${TOOL} aria-pressed:bg-surface-selected`}
            aria-label={t("meetings.governance.viewAttendance")}
            aria-pressed={view === "attendance"}
            onClick={() => setView(view === "attendance" ? "room" : "attendance")}
          >
            <UserRoundCheck aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
      {rollView ? (
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
          {raised.length > 0 ? (
            <section className="mb-2 shrink-0">
              <h3
                id={handsHeadingId}
                className="mx-1 mb-1.5 flex items-center gap-1.5 text-caption font-semibold text-warning-soft-foreground"
              >
                <Hand aria-hidden className="size-3.5 shrink-0" />
                {t("meetings.panel.people.hands", { count: raised.length })}
              </h3>
              <ul
                aria-labelledby={handsHeadingId}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable list takes focus so a keyboard can scroll it (axe scrollable-region-focusable)
                tabIndex={0}
                className="max-h-48 overflow-y-auto"
              >
                {raised.map((participant, i) => (
                  <li key={participant.identity} className="flex min-h-11.5 items-center gap-2.5 px-1">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-soft text-micro font-bold tabular-nums text-warning-soft-foreground">
                      {i + 1}
                    </span>
                    <MeetingPersonAvatar
                      name={displayName(participant)}
                      avatarUrl={avatarOf(participant.identity)}
                      tint={tintOf(participant.identity)}
                      size={30}
                    />
                    <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                      {displayName(participant)}
                    </span>
                    {/* Only your own: nobody lowers someone else's hand. */}
                    {participant.isLocal ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7.5 shrink-0 rounded-[9px] bg-surface-hover px-2.5 text-caption font-medium"
                        onClick={toggleHand}
                      >
                        {t("meetings.panel.people.lowerMine")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <h3 id={roomHeadingId} className="mx-1 mb-1.5 shrink-0 text-caption font-semibold text-muted-foreground">
            {t("meetings.panel.people.inRoom", { count: filtered.length })}
          </h3>

          {/* The scribe row sits above the windowed list: one row of offset, well inside its overscan. */}
          <div ref={list.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {scribeInRoom && !needle ? (
              <div className="flex min-h-12 items-center gap-2.5 px-1 py-1.5">
                <ScribeMark size={30} state="live" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-foreground">{t("meetings.scribe.name")}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {t("meetings.panel.people.scribeRole")}
                  </span>
                </span>
              </div>
            ) : null}
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-caption text-muted-foreground">
                {needle ? t("meetings.noPeopleMatch") : t("meetings.noParticipantsYet")}
              </p>
            ) : (
              // A long room mounts only the rows near the viewport; each row
              // keeps its place in the whole list for assistive tech.
              <ul
                aria-labelledby={roomHeadingId}
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
                        host={Boolean(meta?.isHost || (participant.isLocal && canHost))}
                        sharedMic={Boolean(meta?.api.shared_mic)}
                        // The guest chip wins: a guest is an observer unless promoted.
                        roleChip={participantRole(participant, guests) ?? dutyRole(meta?.api)}
                        avatarUrl={avatarOf(participant.identity)}
                        canHost={canHost}
                        removable={!meta?.isHost}
                        pinned={pinnedIdentity === participant.identity}
                        menuExtra={
                          !guestMode && meetingId && meta ? (
                            <>
                              {canHost ? (
                                <MeetingDutyMenuItems
                                  meetingId={meetingId}
                                  participant={meta.api}
                                  name={displayName(participant)}
                                  separatorBefore
                                  rollFinalized={rollFinalized}
                                  standingOnly={meta.isHost}
                                />
                              ) : null}
                              {/* Never a phone line: the scribe would diarize it under the caller's id. */}
                              {isClerk && scribeInRoom && participantRole(participant, guests) !== "phone" ? (
                                <MeetingSharedMicMenuItem
                                  meetingId={meetingId}
                                  participant={meta.api}
                                  name={displayName(participant)}
                                  separatorBefore={!canHost}
                                />
                              ) : null}
                            </>
                          ) : null
                        }
                      />
                    </li>
                  );
                })}
                </ul>
              )}
          </div>
        </>
      )}
      {canInvite && meetingId && workspaceId ? (
        <AddMeetingParticipantsDialog
          workspaceId={workspaceId}
          meetingId={meetingId}
          excludeUserIds={excludeUserIds}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      ) : null}
    </div>
  );
}
