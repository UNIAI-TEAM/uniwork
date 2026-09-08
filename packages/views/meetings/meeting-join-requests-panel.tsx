"use client";
import { useTranslation } from "react-i18next";
import { UserRoundCheck } from "lucide-react";
import { useJoinRequests } from "@uniwork/core/meetings";
import { MeetingJoinRequestRow } from "./meeting-join-request-row";
import { MeetingPanelCard } from "./meeting-panel-card";
import { useJoinRequestActions } from "./use-join-request-actions";

export function MeetingJoinRequestsPanel({
  meetingId,
  compact,
}: {
  meetingId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data: requests } = useJoinRequests(meetingId);
  const { approveOne, rejectOne, approving, rejecting } = useJoinRequestActions(meetingId);
  const pending = (requests ?? []).filter((r) => r.status === "PENDING");
  if (pending.length === 0) return null;

  const title = `${t("meetings.joinRequests")} ${t("meetings.pendingCount", { count: pending.length })}`;

  const list = (
    <ul className={compact ? "space-y-2" : "-mx-4 -mt-4 divide-y divide-border"}>
      {pending.map((r) => (
        <li key={r.id} className={compact ? undefined : "px-4 py-2.5"}>
          <MeetingJoinRequestRow
            request={r}
            variant="compact"
            approving={approving}
            rejecting={rejecting}
            onApprove={() => approveOne(r.id)}
            onReject={() => rejectOne(r.id)}
          />
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <MeetingPanelCard id="join-requests-heading" icon={UserRoundCheck} tone="warning" title={title}>
        {list}
      </MeetingPanelCard>
    );
  }

  return (
    <section className="mt-6" aria-labelledby="join-requests-heading">
      <h3 id="join-requests-heading" className="mb-2 text-label font-medium text-muted-foreground">
        {title}
      </h3>
      {list}
    </section>
  );
}
