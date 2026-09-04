"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { MeetingPanelCard } from "./meeting-panel-card";
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
  const excludeUserIds = [
    ...new Set(
      [meeting.host_user_id, ...active.map((p) => p.user_id)].filter((id): id is string => Boolean(id)),
    ),
  ];
  const hasCandidates = (members ?? []).some((m) => !excludeUserIds.includes(m.user_id));

  return (
    <MeetingPanelCard id="participants-heading" title={t("meetings.participants")}>
      <ul className="-mx-4 -mt-4 divide-y divide-border border-b border-border">
        {active.map((p) => {
          const isHost = p.user_id === meeting.host_user_id;
          const rsvp = rsvpByParticipant.get(p.id);
          return (
            <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-body text-foreground">{p.display_name_snapshot || p.user_id}</div>
                <div className="text-caption text-muted-foreground">
                  {isHost ? t("meetings.host") : t("meetings.attendees")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {rsvp ? <MeetingRsvpBadge status={rsvp} /> : null}
                {canManage && !isHost ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(p.id, { onError: (err) => toastApiError(err, t("common.error")) })
                    }
                  >
                    {t("meetings.remove")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canManage && hasCandidates ? (
        <form
          className="mt-3 flex min-w-0 flex-col gap-3"
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
            {t("meetings.inviteMember")}
          </Button>
        </form>
      ) : null}
      {showTransferHost ? <TransferHostDialog workspaceId={workspaceId} meeting={meeting} /> : null}
    </MeetingPanelCard>
  );
}
