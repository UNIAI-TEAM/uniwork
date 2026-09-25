"use client";
import { useTranslation } from "react-i18next";
import { UserRoundCheck } from "lucide-react";
import { useJoinRequests } from "@uniwork/core/meetings";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { MeetingJoinRequestRow } from "./meeting-join-request-row";
import { PanelCard } from "../common/panel-card";
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
  const { approveOne, rejectOne, isApproving, isRejecting } = useJoinRequestActions(meetingId);
  const pending = (requests ?? []).filter((r) => r.status === "PENDING");
  if (pending.length === 0) return null;

  const title = t("meetings.joinRequests");
  const count = (
    <Badge className="bg-warning-soft tabular-nums text-warning-soft-foreground">
      {t("meetings.pendingCount", { count: pending.length })}
    </Badge>
  );

  const list = (
    <ul className={compact ? "space-y-2" : "-mx-4 -mt-4 divide-y divide-border"}>
      {pending.map((r) => (
        <li key={r.id} className={compact ? undefined : "px-4 py-2.5"}>
          <MeetingJoinRequestRow
            request={r}
            variant="compact"
            approving={isApproving(r.id)}
            rejecting={isRejecting(r.id)}
            onApprove={() => approveOne(r.id)}
            onReject={() => rejectOne(r.id)}
          />
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <PanelCard id="join-requests-heading" icon={UserRoundCheck} iconTone="warning" tone="warning" title={title} action={count}>
        {list}
      </PanelCard>
    );
  }

  return (
    <section className="mt-6" aria-labelledby="join-requests-heading">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="join-requests-heading" className="text-overline text-muted-foreground">
          {title}
        </h3>
        {count}
      </div>
      {list}
    </section>
  );
}
