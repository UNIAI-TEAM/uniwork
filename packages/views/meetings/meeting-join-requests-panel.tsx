"use client";
import { useTranslation } from "react-i18next";
import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";

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

  return (
    <section className={compact ? undefined : "mt-6"} aria-labelledby="join-requests-heading">
      <h3 id="join-requests-heading" className="mb-2 text-label font-medium text-muted-foreground">
        {t("meetings.joinRequests")}{" "}
        <span className="tabular-nums">{t("meetings.pendingCount", { count: pending.length })}</span>
      </h3>
      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="min-w-0 truncate text-body">{r.display_name_snapshot || r.requester_user_id}</span>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={approve.isPending}
                onClick={() => approve.mutate(r.id, { onError: () => toast.error(t("common.error")) })}
              >
                {t("meetings.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={reject.isPending}
                onClick={() => reject.mutate({ requestId: r.id }, { onError: () => toast.error(t("common.error")) })}
              >
                {t("meetings.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
