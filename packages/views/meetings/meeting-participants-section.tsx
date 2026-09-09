"use client";
import { useState } from "react";
import { Crown, UserMinus, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { PanelCard } from "../common/panel-card";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRsvpBadge } from "./meeting-status-badge";
import { MemberMultiPicker } from "./member-multi-picker";
import { TransferHostDialog } from "./transfer-host-dialog";

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
  const { data: participants } = useParticipants(meeting.id);
  const { data: members } = useMembers(workspaceId);
  const remove = useRemoveParticipant(meeting.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const rsvpByParticipant = new Map(invitations.map((i) => [i.participant_id, i.response_status]));
  const active = (participants ?? []).filter((p) => p.status === "ACTIVE");
  // The host reads first; everyone else keeps the server's order.
  const ordered = [...active].sort(
    (a, b) => Number(b.user_id === meeting.host_user_id) - Number(a.user_id === meeting.host_user_id),
  );
  const excludeUserIds = [
    ...new Set(
      [meeting.host_user_id, ...active.map((p) => p.user_id)].filter((id): id is string => Boolean(id)),
    ),
  ];
  const hasCandidates = (members ?? []).some((m) => !excludeUserIds.includes(m.user_id));

  return (
    <PanelCard
      id="participants-heading"
      icon={Users}
      title={t("meetings.participants")}
      action={
        active.length > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {t("meetings.peopleCount", { count: active.length })}
          </Badge>
        ) : null
      }
      flush
      footer={showTransferHost ? <TransferHostDialog workspaceId={workspaceId} meeting={meeting} /> : undefined}
    >
      {ordered.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-label text-foreground">{t("meetings.noParticipantsYet")}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t("meetings.noParticipantsHint")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {ordered.map((p) => {
            const isHost = p.user_id === meeting.host_user_id;
            const name = p.display_name_snapshot || p.user_id || "?";
            const rsvp = rsvpByParticipant.get(p.id);
            return (
              <li key={p.id} className="group flex min-w-0 items-center gap-3 px-4 py-2.5">
                <MeetingPersonAvatar name={name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-foreground">{name}</div>
                  <div className="flex items-center gap-1 text-caption text-muted-foreground">
                    {isHost ? <Crown aria-hidden className="size-3 text-warning" /> : null}
                    {isHost ? t("meetings.host") : t("meetings.attendees")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {rsvp ? <MeetingRsvpBadge status={rsvp} /> : null}
                  {canManage && !isHost ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(p.id, { onError: (err) => toastApiError(err, t("common.error")) })
                      }
                    >
                      <UserMinus aria-hidden />
                      {t("meetings.remove")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canManage && hasCandidates ? (
        <form
          className="flex min-w-0 flex-col gap-2.5 border-t border-border px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected.length === 0) return;
            setInviting(true);
            void Promise.allSettled(selected.map((userId) => inviteParticipant(meeting.id, userId)))
              .then((results) => {
                const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
                if (failed) {
                  toastApiError(failed.reason, t("common.error"));
                  return;
                }
                toast.success(t("meetings.invitedMembers", { count: selected.length }));
                setSelected([]);
              })
              .finally(() => setInviting(false));
          }}
        >
          <MemberMultiPicker
            workspaceId={workspaceId}
            value={selected}
            onChange={setSelected}
            excludeUserIds={excludeUserIds}
            searchable
          />
          <Button type="submit" size="sm" className="self-start" disabled={inviting || selected.length === 0}>
            <UserPlus aria-hidden />
            {t("meetings.inviteMember")}
          </Button>
        </form>
      ) : null}
    </PanelCard>
  );
}
