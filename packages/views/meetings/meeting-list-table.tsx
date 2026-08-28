"use client";
import { useTranslation } from "react-i18next";
import { useMembers } from "@uniwork/core/workspaces";
import type { Meeting } from "@uniwork/core/types";
import { formatMeetingRange } from "./meeting-datetime";
import { MeetingStatusBadge } from "./meeting-status-badge";

export function MeetingListTable({
  meetings,
  onOpen,
}: {
  meetings: Meeting[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(meetings[0]?.workspace_id ?? "");
  const hostName = (id?: string) => members?.find((m) => m.user_id === id)?.display_name ?? t("meetings.host");

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] border-collapse text-body">
        <thead>
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            <th className="px-4 py-2 font-medium">{t("meetings.meetingTitle")}</th>
            <th className="px-4 py-2 font-medium">{t("meetings.status")}</th>
            <th className="px-4 py-2 font-medium">{t("meetings.colWhen")}</th>
            <th className="px-4 py-2 font-medium">{t("meetings.host")}</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((m) => (
            <tr
              key={m.id}
              onClick={() => onOpen(m.id)}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted"
            >
              <td className="max-w-[12rem] px-4 py-2.5 text-foreground sm:max-w-xs">
                <span className="block truncate">{m.title}</span>
              </td>
              <td className="px-4 py-2.5">
                <MeetingStatusBadge status={m.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                {formatMeetingRange(m.starts_at, m.ends_at, m.timezone)}
              </td>
              <td className="max-w-[8rem] px-4 py-2.5 text-muted-foreground">
                <span className="block truncate">{hostName(m.host_user_id ?? m.created_by)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
