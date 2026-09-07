"use client";
import { useTranslation } from "react-i18next";
import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { MeetingPanelCard } from "./meeting-panel-card";

export function MeetingJoinRequestsPanel({
  meetingId,
  compact,
}: {
  meetingId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { data: requests } = useJoinRequests(meetingId);
  const approve = useApproveJoinRequest(meetingId);
  const reject = useRejectJoinRequest(meetingId);
  const pending = (requests ?? []).filter((r) => r.status === "PENDING");
  if (pending.length === 0) return null;

  const title = `${t("meetings.joinRequests")} ${t("meetings.pendingCount", { count: pending.length })}`;

  const list = (
    <ul className={compact ? "space-y-2" : "-mx-4 -mt-4 divide-y divide-border"}>
      {pending.map((r) => (
        <li
          key={r.id}
          className={
            compact
              ? "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
              : "flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          }
        >
          <span className="min-w-0 truncate text-body">{r.display_name_snapshot || r.requester_user_id}</span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate(r.id, { onError: (err) => toastApiError(err, t("common.error")) })}
            >
              {t("meetings.approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={reject.isPending}
              onClick={() => reject.mutate({ requestId: r.id }, { onError: (err) => toastApiError(err, t("common.error")) })}
            >
              {t("meetings.reject")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <MeetingPanelCard id="join-requests-heading" title={title}>
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
