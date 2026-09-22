"use client";
import { useState } from "react";
import { ArrowRightLeft, Crown, MoreHorizontal, UserMinus, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { ConfirmDialog } from "../common/form-dialog";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { toastApiError } from "../toast-api-error";
import { AddMeetingParticipantsDialog } from "./add-meeting-participants-dialog";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";
import { MeetingRsvpBadge } from "./meeting-status-badge";
import { TransferHostDialog } from "./transfer-host-dialog";
import { useMemberIndex } from "./use-member-index";

/**
 * Who is on the meeting. The host reads first; admin lives where it applies —
 * "Thêm người" in the header, and per-person actions in each row's menu — so
 * the page does not carry a permanent invite form or host picker.
 */
export function MeetingParticipantsSection({
  workspaceId,
  meeting,
  invitations,
  canManage,
  showTransferHost,
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
  canManage: boolean;
  showTransferHost?: boolean;
}) {
  const { t } = useTranslation();
  const {
    data: participants,
    isPending: participantsPending,
    isError: participantsFailed,
    refetch: refetchParticipants,
  } = useParticipants(meeting.id);
  const { memberOf, members } = useMemberIndex(workspaceId);
  const remove = useRemoveParticipant(meeting.id);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [handingOver, setHandingOver] = useState<{ userId: string; name: string } | null>(null);
  const rsvpByParticipant = new Map(invitations.map((i) => [i.participant_id, i.response_status]));
  const active = (participants ?? []).filter((p) => p.status === "ACTIVE");
  const ordered = [...active].sort(
    (a, b) => Number(b.user_id === meeting.host_user_id) - Number(a.user_id === meeting.host_user_id),
  );
  const excludeUserIds = [
    ...new Set(
      [meeting.host_user_id, ...active.map((p) => p.user_id)].filter((id): id is string => Boolean(id)),
    ),
  ];
  const hasCandidates = members.some((m) => !excludeUserIds.includes(m.user_id));
  const nameOf = (p: MeetingParticipant) =>
    p.display_name_snapshot || memberOf(p.user_id)?.display_name || t("meetings.formerMember");
  // Only a workspace member already on the roster can take the host role.
  const canTakeHost = (p: MeetingParticipant) =>
    Boolean(showTransferHost && p.principal_type === "USER" && p.user_id && p.user_id !== meeting.host_user_id);

  return (
    <PanelCard
      id="participants-heading"
      icon={Users}
      iconTone={moduleTone("meetings")}
      title={t("meetings.participants")}
      action={
        <>
          {active.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {t("meetings.peopleCount", { count: active.length })}
            </Badge>
          ) : null}
          {canManage && hasCandidates ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
              <UserPlus aria-hidden />
              {t("meetings.addPeople")}
            </Button>
          ) : null}
        </>
      }
      flush
    >
      {participantsPending ? (
        <MeetingRowsSkeleton rows={2} className="py-1" />
      ) : participantsFailed ? (
        <MeetingSectionError
          className="m-4"
          message={t("meetings.participantsLoadFailed")}
          onRetry={() => void refetchParticipants()}
        />
      ) : ordered.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-label text-foreground">{t("meetings.noParticipantsYet")}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t("meetings.noParticipantsHint")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {ordered.map((p) => {
            const isHost = p.user_id === meeting.host_user_id;
            const name = nameOf(p);
            const member = memberOf(p.user_id);
            const rsvp = rsvpByParticipant.get(p.id);
            const subtitle = isHost
              ? t("meetings.host")
              : p.principal_type === "GUEST"
                ? t("meetings.guest")
                : member?.email;
            const offerHost = canTakeHost(p);
            return (
              <li key={p.id} className="group flex min-w-0 items-center gap-3 px-4 py-2.5">
                <MeetingPersonAvatar name={name} avatarUrl={member?.avatar_url} size="default" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-foreground">{name}</div>
                  {subtitle ? (
                    <div className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
                      {isHost ? <Crown aria-hidden className="size-3 shrink-0" /> : null}
                      <span className="truncate">{subtitle}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {rsvp && !isHost ? <MeetingRsvpBadge status={rsvp} /> : null}
                  {canManage && !isHost ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground"
                            aria-label={t("meetings.participantActions", { name })}
                          />
                        }
                      >
                        <MoreHorizontal aria-hidden className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        {offerHost ? (
                          <DropdownMenuItem onClick={() => setHandingOver({ userId: p.user_id!, name })}>
                            <ArrowRightLeft aria-hidden className="size-4" />
                            {t("meetings.transferHostMenu")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={remove.isPending && remove.variables === p.id}
                          onClick={() => setRemoving({ id: p.id, name })}
                        >
                          <UserMinus aria-hidden className="size-4" />
                          {t("meetings.remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? (
        <AddMeetingParticipantsDialog
          workspaceId={workspaceId}
          meetingId={meeting.id}
          excludeUserIds={excludeUserIds}
          open={adding}
          // The dialog refreshes the roster itself as soon as anyone is invited.
          onOpenChange={setAdding}
        />
      ) : null}
      <TransferHostDialog
        workspaceId={workspaceId}
        meetingId={meeting.id}
        target={handingOver}
        onClose={() => setHandingOver(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("meetings.removeParticipantTitle", { name: removing?.name ?? "" })}
        description={t("meetings.removeParticipantHint")}
        confirmLabel={t("meetings.removeParticipantConfirm")}
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(removing.id, {
            onSuccess: () => setRemoving(null),
            onError: (err) => toastApiError(err, t("common.error")),
          });
        }}
      />
    </PanelCard>
  );
}
