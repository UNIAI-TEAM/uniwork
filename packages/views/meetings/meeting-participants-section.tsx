"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useInviteParticipant, useParticipants, useRemoveParticipant } from "@uniwork/core/meetings";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRsvpBadge } from "./meeting-status-badge";

export function MeetingParticipantsSection({
  workspaceId,
  meeting,
  invitations,
  canManage,
}: {
  workspaceId: string;
  meeting: Meeting;
  invitations: MeetingInvitation[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { data: participants } = useParticipants(meeting.id);
  const { data: members } = useMembers(workspaceId);
  const invite = useInviteParticipant(meeting.id);
  const remove = useRemoveParticipant(meeting.id);
  const [userId, setUserId] = useState("");
  const rsvpByParticipant = new Map(invitations.map((i) => [i.participant_id, i.response_status]));
  const active = (participants ?? []).filter((p) => p.status === "ACTIVE");
  const candidates = (members ?? []).filter(
    (m) => !active.some((p) => p.user_id === m.user_id) && m.user_id !== meeting.host_user_id,
  );

  return (
    <section className="mt-6" aria-labelledby="participants-heading">
      <h2 id="participants-heading" className="mb-2 text-body font-semibold text-foreground">
        {t("meetings.participants")}
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {active.map((p) => {
          const isHost = p.user_id === meeting.host_user_id;
          const rsvp = rsvpByParticipant.get(p.id);
          return (
            <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <MeetingPersonAvatar name={p.display_name_snapshot || p.user_id || ""} size="default" />
                <div className="min-w-0">
                  <div className="truncate text-body text-foreground">{p.display_name_snapshot || p.user_id}</div>
                  <div className="text-caption text-muted-foreground">
                    {isHost ? t("meetings.host") : t("meetings.attendees")}
                  </div>
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
                      remove.mutate(p.id, { onError: () => toast.error(t("common.error")) })
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
      {canManage && candidates.length > 0 ? (
        <form
          className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (!userId) return;
            invite.mutate(userId, {
              onSuccess: () => setUserId(""),
              onError: () => toast.error(t("common.error")),
            });
          }}
        >
          <div className="min-w-0 flex-1">
            <Select
              aria-label={t("meetings.inviteMember")}
              value={userId}
              onValueChange={(v) => setUserId(v ?? "")}
              items={[
                { value: "", label: t("meetings.inviteMember") },
                ...candidates.map((m) => ({ value: m.user_id, label: m.display_name })),
              ]}
            />
          </div>
          <Button type="submit" size="sm" className="shrink-0" disabled={invite.isPending || !userId}>
            {t("meetings.inviteMember")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
