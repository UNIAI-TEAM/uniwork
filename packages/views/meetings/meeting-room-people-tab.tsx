"use client";

import { useMemo, useState } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { ChevronDown, Hand, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@uniwork/ui/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@uniwork/ui/components/ui/input-group";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";
import { MeetingJoinRequestsPanel } from "./meeting-join-requests-panel";
import { MeetingParticipantRow } from "./meeting-participant-row";
import { useMeetingSignals } from "./use-meeting-signals";

const PARTICIPANT_IDENTITY_PREFIX = "uw_participant_";

function participantIdFromIdentity(identity: string): string | null {
  return identity.startsWith(PARTICIPANT_IDENTITY_PREFIX)
    ? identity.slice(PARTICIPANT_IDENTITY_PREFIX.length)
    : null;
}

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
  const { data: apiParticipants } = useParticipants(guestMode ? "" : (meetingId ?? ""));
  const remove = useRemoveParticipant(meetingId ?? "");
  const [search, setSearch] = useState("");
  const [contributorsOpen, setContributorsOpen] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

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
      { participantId: string | null; isHost: boolean; userId: string | null }
    >();
    for (const p of apiParticipants ?? []) {
      const identity = `${PARTICIPANT_IDENTITY_PREFIX}${p.id}`;
      byIdentity.set(identity, {
        participantId: p.id,
        isHost: p.user_id === hostUserId,
        userId: p.user_id ?? null,
      });
    }
    return byIdentity;
  }, [apiParticipants, hostUserId]);

  const ordered = orderParticipants(liveParticipants, hands, pinnedIdentity);
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? ordered.filter((p) => displayName(p).toLowerCase().includes(needle))
    : ordered;

  function rowSubtitle(participant: Participant): string | undefined {
    const meta = participantMeta.get(participant.identity);
    if (meta?.isHost) return t("meetings.meetingHost");
    if (participant.isLocal && canHost) return t("meetings.meetingHost");
    if (hands.includes(participant.identity)) return t("meetings.handRaised");
    return undefined;
  }

  function handleRemove(participant: Participant) {
    const participantId = participantMeta.get(participant.identity)?.participantId
      ?? participantIdFromIdentity(participant.identity);
    if (!participantId || !meetingId) return;
    remove.mutate(participantId, {
      onError: (err) => toastApiError(err, t("common.error")),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 shrink-0">
        <h2 className="text-title-sm font-semibold text-foreground">{t("meetings.people")}</h2>
      </div>

      {canHost && meetingId && workspaceId && !guestMode ? (
        <Button
          type="button"
          className="mb-3 h-9 w-full shrink-0 rounded-xl bg-brand text-brand-foreground hover:bg-brand/90"
          onClick={() => setInviteOpen(true)}
        >
          <Plus aria-hidden className="size-4" />
          {t("meetings.addPeople")}
        </Button>
      ) : null}

      <InputGroup className="mb-4 h-9 shrink-0 rounded-xl bg-muted/30">
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

      {canHost && meetingId ? (
        <div className="mb-3 shrink-0">
          <MeetingJoinRequestsPanel meetingId={meetingId} compact />
        </div>
      ) : null}

      {hands.length > 0 ? (
        <p className="mb-3 flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-selected px-3 py-2 text-label text-brand">
          <Hand aria-hidden className="size-3.5 shrink-0" />
          {t("meetings.handsRaised", { count: hands.length })}
        </p>
      ) : null}

      <p className="mb-2 shrink-0 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
        {t("meetings.inTheMeeting")}
      </p>

      <Collapsible open={contributorsOpen} onOpenChange={setContributorsOpen} className="min-h-0 flex-1">
        <CollapsibleTrigger className="mb-2 flex w-full shrink-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-body font-medium text-foreground hover:bg-muted/40">
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !contributorsOpen && "-rotate-90")}
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
              {filtered.map((participant) => (
                <li key={participant.identity}>
                  <MeetingParticipantRow
                    participant={participant}
                    subtitle={rowSubtitle(participant)}
                    canHost={canHost}
                    pinned={pinnedIdentity === participant.identity}
                    onRemove={
                      canHost && !participant.isLocal && meetingId
                        ? () => handleRemove(participant)
                        : undefined
                    }
                  />
                </li>
              ))}
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
    </div>
  );
}
