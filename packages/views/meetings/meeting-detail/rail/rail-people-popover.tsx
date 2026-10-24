"use client";
import { useState } from "react";
import { ArrowRightLeft, Crown, Ellipsis, Mail, UserMinus, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import { useAttendanceFinalized, useMeetingAttendance } from "@uniwork/core/meetings/attendance";
import type { MeetingParticipant } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../../toast-api-error";
import { AddMeetingParticipantsDialog } from "../../add-meeting-participants-dialog";
import { MeetingDutyMenuItems, dutyRole } from "../../meeting-duty-menu-items";
import { MeetingPersonAvatar } from "../../meeting-person";
import { MeetingRoleChip } from "../../meeting-role-chip";
import { TransferHostDialog } from "../../transfer-host-dialog";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { AvatarStack } from "../ui/avatar-stack";
import { kitButton } from "../ui/kit-buttons";
import { Dialog440, SideSheet } from "../ui/overlay";
import { RailProp } from "../ui/rail";
import { attendedText, isLive, rsvpOf, rsvpTallyText } from "./rail-model";
import { RailPopover, useRailPopover } from "./rail-popover";

/** More people than this read in a 480 drawer instead of a popover (brief §2.6). */
const POPOVER_LIMIT = 8;

/** Host first, then the roster as the server orders it. */
function useRoster() {
  const { meeting } = useDetail();
  const query = useParticipants(meeting.id);
  const active = (query.data ?? []).filter((p) => p.status === "ACTIVE");
  const ordered = [...active].sort(
    (a, b) => Number(b.user_id === meeting.host_user_id) - Number(a.user_id === meeting.host_user_id),
  );
  return { query, ordered };
}

/**
 * The rail's people row: "Người dự" with faces and RSVP dots before the
 * meeting ("3 người" + "1 nhận lời · 1 chưa phản hồi"), "3/3 có mặt" after;
 * while live it is "Lời mời" with the answers. It opens the roster, where
 * the host adds, removes, hands over and gives duties (≤ 8 in a popover,
 * more in a drawer).
 */
export function RailPeopleRow() {
  const { t } = useTranslation();
  const { meeting, displayStatus, invitations, memberIndex, canHost, viewer } = useDetail();
  const popover = useRailPopover();
  const { ordered } = useRoster();
  const live = isLive(displayStatus);
  const ended = displayStatus === "ENDED";
  const { data: roll } = useMeetingAttendance(meeting.id, ended);
  const canManage = canHost && (displayStatus === "SCHEDULED" || live);
  const rsvpByParticipant = new Map(invitations.map((i) => [i.participant_id, i.response_status]));
  const others = ordered.filter((p) => p.user_id !== meeting.host_user_id);
  const tally = rsvpTallyText(others.map((p) => rsvpByParticipant.get(p.id)), t);
  const nameOf = (p: MeetingParticipant) =>
    p.display_name_snapshot || memberIndex.memberOf(p.user_id)?.display_name || t("meetings.formerMember");

  if (live) {
    // The roll has its own row; this one only counts the answers, and opens the roster for the host.
    if (!tally) return null;
    return (
      <div ref={popover.anchor}>
        <RailProp
          icon={Mail}
          label={t("meetings.detail.rail.invites")}
          value={tally}
          onClick={canManage ? popover.toggle : undefined}
          chevron={false}
          ariaLabel={canManage ? t("meetings.detail.rail.invitesAria", { tally }) : undefined}
        />
        {canManage ? <PeopleOverlay popover={popover} canManage /> : null}
      </div>
    );
  }

  if (ordered.length === 0) return null;
  const dots = displayStatus === "SCHEDULED" || displayStatus === "MISSED";
  const people = ordered.map((p) => {
    const answer = rsvpOf(rsvpByParticipant.get(p.id));
    return {
      id: p.id,
      name: nameOf(p),
      avatarUrl: memberIndex.memberOf(p.user_id)?.avatar_url,
      tint: meetingAvatarTint(p.principal_type === "USER" ? p.user_id : null, memberIndex.members),
      rsvp: dots && p.user_id !== meeting.host_user_id ? (answer === "maybe" ? "wait" : answer) : undefined,
    } as const;
  });
  const value = ended && roll ? attendedText(roll.summary, t) : t("meetings.detail.rail.people_count", { count: ordered.length });
  const sub = ended || viewer === "outsider" ? undefined : tally || undefined;
  const action = t(ended ? "meetings.detail.rail.seeRoll" : canManage ? "meetings.detail.rail.seeAndAdd" : "meetings.detail.rail.seeList");

  return (
    <div ref={popover.anchor}>
      <RailProp
        icon={Users}
        label={t("meetings.detail.rail.people")}
        value={
          <>
            <AvatarStack people={people} className="-my-0.5 mr-1.5" />
            <span className="whitespace-nowrap">{value}</span>
          </>
        }
        // RSVP dots hang below the faces: the tally clears them (kit `.prop-v:has(.rsvp) .prop-sub`).
        sub={sub ? <span className={dots ? "mt-1.25 block" : undefined}>{sub}</span> : undefined}
        onClick={popover.toggle}
        ariaLabel={t("meetings.detail.rail.peopleAria", { value: sub ? `${value}, ${sub}` : value, action })}
      />
      <PeopleOverlay popover={popover} canManage={canManage} />
    </div>
  );
}

function PeopleOverlay({ popover, canManage }: { popover: ReturnType<typeof useRailPopover>; canManage: boolean }) {
  const { t } = useTranslation();
  const { workspaceId, meeting, displayStatus, memberIndex } = useDetail();
  const { ordered } = useRoster();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [handingOver, setHandingOver] = useState<{ userId: string; name: string } | null>(null);
  const remove = useRemoveParticipant(meeting.id);
  const ended = displayStatus === "ENDED";
  const { data: roll } = useMeetingAttendance(meeting.id, ended);
  const excludeUserIds = [
    ...new Set([meeting.host_user_id, ...ordered.map((p) => p.user_id)].filter((id): id is string => Boolean(id))),
  ];
  const canAdd = canManage && memberIndex.members.some((m) => !excludeUserIds.includes(m.user_id));
  const title = ended && roll ? attendedText(roll.summary, t) : t("meetings.detail.rail.people_count", { count: ordered.length });
  const footer =
    canAdd || roll?.finalized_at ? (
      <>
        <span className="text-caption text-muted-foreground">{roll?.finalized_at ? t("meetings.governance.finalizedToast") : null}</span>
        {canAdd ? (
          <Button
            type="button"
            variant="outline"
            className={cn(kitButton.sm, kitButton.outline)}
            onClick={() => {
              popover.setOpen(false);
              setAdding(true);
            }}
          >
            <UserPlus aria-hidden />
            {t("meetings.addPeople")}
          </Button>
        ) : null}
      </>
    ) : undefined;
  // The dialogs live outside the popover, which closes when one opens.
  const body = (
    <PeopleList
      canManage={canManage}
      removingId={remove.isPending ? remove.variables : undefined}
      onRemove={(who) => {
        popover.setOpen(false);
        setRemoving(who);
      }}
      onHandOver={(who) => {
        popover.setOpen(false);
        setHandingOver(who);
      }}
    />
  );

  return (
    <>
      {ordered.length > POPOVER_LIMIT ? (
        <SideSheet open={popover.open} onOpenChange={popover.setOpen} width={480} title={title} footer={footer}>
          {body}
        </SideSheet>
      ) : (
        <RailPopover state={popover} title={title} footer={footer}>
          {body}
        </RailPopover>
      )}
      <TransferHostDialog
        workspaceId={workspaceId}
        meetingId={meeting.id}
        target={handingOver}
        onClose={() => setHandingOver(null)}
      />
      <Dialog440
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        role="alertdialog"
        title={t("meetings.removeParticipantTitle", { name: removing?.name ?? "" })}
        description={t("meetings.removeParticipantHint")}
        footer={
          <>
            <Button type="button" variant="ghost" className={kitButton.ghost} onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={remove.isPending || undefined}
              onClick={() => {
                if (!removing || remove.isPending) return;
                remove.mutate(removing.id, {
                  onSuccess: () => setRemoving(null),
                  onError: (err) => toastApiError(err, t("common.error")),
                });
              }}
            >
              {t("meetings.removeParticipantConfirm")}
            </Button>
          </>
        }
      />
      {canManage ? (
        <AddMeetingParticipantsDialog
          workspaceId={workspaceId}
          meetingId={meeting.id}
          excludeUserIds={excludeUserIds}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}
    </>
  );
}

type Person = { id: string; name: string };

/** The roster rows, with the host's per-person menu (hand over, duties, remove). */
function PeopleList({
  canManage,
  removingId,
  onRemove,
  onHandOver,
}: {
  canManage: boolean;
  removingId?: string;
  onRemove: (who: Person) => void;
  onHandOver: (who: { userId: string; name: string }) => void;
}) {
  const { t } = useTranslation();
  const { meeting, displayStatus, invitations, memberIndex } = useDetail();
  // Opened from a row that only draws once the roster is in, so it never waits or fails here.
  const { ordered } = useRoster();
  const live = isLive(displayStatus);
  const ended = displayStatus === "ENDED";
  // A meeting that has not started has no roll to lock.
  const rollFinalized = useAttendanceFinalized(meeting.id, canManage && live);
  const { data: roll } = useMeetingAttendance(meeting.id, ended);
  const rsvpByParticipant = new Map(invitations.map((i) => [i.participant_id, i.response_status]));
  const markOf = new Map((roll?.rows ?? []).map((r) => [r.participant_id, r.status]));

  return (
    <ul className="flex flex-col">
      {ordered.map((p) => {
        const isHost = p.user_id === meeting.host_user_id;
        const member = memberIndex.memberOf(p.user_id);
        const name = p.display_name_snapshot || member?.display_name || t("meetings.formerMember");
        const subtitle = isHost ? t("meetings.host") : p.principal_type === "GUEST" ? t("meetings.guest") : member?.email;
        const duty = dutyRole(p);
        const mark = markOf.get(p.id);
        const rsvp = rsvpByParticipant.get(p.id);
        const state = ended
          ? mark && t(`meetings.governance.status_${mark}`, { defaultValue: "" })
          : !isHost && rsvp
            ? t(`meetings.rsvp_${rsvp}`, { defaultValue: t("meetings.rsvp_PENDING") })
            : "";
        const offerHost = canManage && p.principal_type === "USER" && Boolean(p.user_id) && !isHost;
        return (
          <li key={p.id} className="flex min-h-12 min-w-0 items-center gap-2.5 py-1.5">
            <MeetingPersonAvatar
              name={name}
              avatarUrl={member?.avatar_url}
              size={24}
              tint={meetingAvatarTint(p.principal_type === "USER" ? p.user_id : null, memberIndex.members)}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium text-foreground">{name}</div>
              {subtitle || duty ? (
                <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
                  {duty ? <MeetingRoleChip role={duty} className="shrink-0" /> : null}
                  {isHost ? <Crown aria-hidden className="size-3 shrink-0" /> : null}
                  {subtitle ? <span className="truncate">{subtitle}</span> : null}
                </div>
              ) : null}
            </div>
            {state ? <span className="shrink-0 text-caption text-muted-foreground">{state}</span> : null}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={kitButton.icon}
                      aria-label={t("meetings.participantActions", { name })}
                    />
                  }
                >
                  <Ellipsis aria-hidden className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  {offerHost ? (
                    <DropdownMenuItem onClick={() => onHandOver({ userId: p.user_id!, name })}>
                      <ArrowRightLeft aria-hidden className="size-4" />
                      {t("meetings.transferHostMenu")}
                    </DropdownMenuItem>
                  ) : null}
                  <MeetingDutyMenuItems
                    meetingId={meeting.id}
                    participant={p}
                    name={name}
                    separatorBefore={offerHost}
                    rollFinalized={rollFinalized}
                    // The host keeps the meeting: only its own standing is theirs to change here.
                    standingOnly={isHost}
                  />
                  {isHost ? null : (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={removingId === p.id}
                        onClick={() => onRemove({ id: p.id, name })}
                      >
                        <UserMinus aria-hidden className="size-4" />
                        {t("meetings.remove")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
