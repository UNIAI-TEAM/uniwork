"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useApproveJoinRequest,
  useCreateInviteLink,
  useInviteParticipant,
  useJoinRequests,
  useParticipants,
  useRejectJoinRequest,
  useRemoveParticipant,
  useTransferHost,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";

export function MeetingHostPanel({
  workspaceId,
  meeting,
}: {
  workspaceId: string;
  meeting: Meeting;
}) {
  const { t } = useTranslation();
  const { data: participants } = useParticipants(meeting.id);
  const { data: requests } = useJoinRequests(meeting.id);
  const { data: members } = useMembers(workspaceId);
  const invite = useInviteParticipant(meeting.id);
  const remove = useRemoveParticipant(meeting.id);
  const approve = useApproveJoinRequest(meeting.id);
  const reject = useRejectJoinRequest(meeting.id);
  const transfer = useTransferHost(workspaceId, meeting.id);
  const createLink = useCreateInviteLink(meeting.id);
  const [copied, setCopied] = useState(false);
  const pending = (requests ?? []).filter((r) => r.status === "PENDING");

  return (
    <section className="mt-8 space-y-4" aria-labelledby="host-panel-heading">
      <h2 id="host-panel-heading" className="text-body font-semibold text-foreground">
        {t("meetings.hostPanel")}
      </h2>
      <div>
        <h3 className="mb-2 text-label font-medium text-muted-foreground">{t("meetings.participants")}</h3>
        <ul className="space-y-2">
          {(participants ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <span className="text-body text-foreground">{p.display_name_snapshot || p.user_id}</span>
              {p.user_id !== meeting.host_user_id && p.status === "ACTIVE" ? (
                <Button variant="outline" size="sm" onClick={() => remove.mutate(p.id)}>
                  {t("meetings.remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const userId = String(fd.get("user_id") ?? "");
            if (userId) invite.mutate(userId);
          }}
        >
          <select name="user_id" className="h-11 flex-1 rounded-md border border-input bg-background px-2 text-body" required>
            <option value="">{t("meetings.inviteMember")}</option>
            {(members ?? [])
              .filter((m) => !(participants ?? []).some((p) => p.user_id === m.user_id && p.status === "ACTIVE"))
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
          </select>
          <Button type="submit" size="sm" disabled={invite.isPending}>
            {t("meetings.inviteMember")}
          </Button>
        </form>
      </div>
      {pending.length > 0 ? (
        <div>
          <h3 className="mb-2 text-label font-medium text-muted-foreground">{t("meetings.joinRequests")}</h3>
          <ul className="space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <span className="text-body">{r.display_name_snapshot || r.requester_user_id}</span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approve.mutate(r.id)}>
                    {t("meetings.approve")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => reject.mutate(r.id)}>
                    {t("meetings.reject")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-label font-medium text-muted-foreground">{t("meetings.inviteLink")}</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={createLink.isPending}
          onClick={() => {
            const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            createLink.mutate(
              { name: t("meetings.inviteLink"), access_mode: "AUTO_ADMIT", expires_at: expires },
              {
                onSuccess: (res) => {
                  const secret = res?.invite_link.secret;
                  const id = res?.invite_link.id;
                  if (!secret || !id) return;
                  const url = `${runtimeConfig().appUrl}${paths.meetingInvite(id)}#secret=${secret}`;
                  void navigator.clipboard.writeText(url).then(() => setCopied(true));
                },
              },
            );
          }}
        >
          {copied ? t("meetings.linkCopied") : t("meetings.createLink")}
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const userId = String(fd.get("host") ?? "");
          if (userId) transfer.mutate(userId);
        }}
      >
        <select name="host" className="h-11 flex-1 rounded-md border border-input bg-background px-2 text-body" required>
          <option value="">{t("meetings.transferHost")}</option>
          {(members ?? [])
            .filter((m) => m.user_id !== meeting.host_user_id)
            .map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={transfer.isPending}>
          {t("meetings.transferHost")}
        </Button>
      </form>
    </section>
  );
}
