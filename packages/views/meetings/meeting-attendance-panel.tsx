"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useClearAttendanceMark,
  useFinalizeAttendance,
  useMarkAttendance,
  useMeetingAttendance,
  useReopenAttendance,
} from "@uniwork/core/meetings/attendance";
import type { AttendanceStatus, Meeting, MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { MeetingAttendanceRowItem } from "./meeting-attendance-row";
import { MeetingAttendanceSummary } from "./meeting-attendance-summary";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

/**
 * The formal roll: members first with their suggested or marked status,
 * observers folded below, and finalize/reopen for whoever clerks.
 */
export function MeetingAttendancePanel({
  meeting,
  canEdit,
  density,
}: {
  meeting: Meeting;
  workspaceId: string;
  canEdit: boolean;
  density: "room" | "compact";
}) {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, refetch } = useMeetingAttendance(meeting.id);
  const mark = useMarkAttendance(meeting.id);
  const clear = useClearAttendanceMark(meeting.id);
  const finalize = useFinalizeAttendance(meeting.id);
  const reopen = useReopenAttendance(meeting.id);
  const [observersOpen, setObserversOpen] = useState(false);
  const onError = (err: unknown) => toastApiError(err, t("common.error"));

  if (isPending) return <MeetingRowsSkeleton rows={3} className="py-1" />;
  if (isError || !data) {
    return <MeetingSectionError message={t("meetings.governance.loadFailed")} onRetry={() => void refetch()} />;
  }
  const finalized = Boolean(data.finalized_at);
  const members = data.rows.filter((r) => r.standing === "MEMBER");
  const observers = data.rows.filter((r) => r.standing !== "MEMBER");
  // A roll read days later needs the date as well as the time.
  const stampOf = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(
      new Date(iso),
    );
  // The finalizer is usually on the roll; an admin who is not falls back to the time alone.
  const finalizerName = data.rows.find((r) => r.user_id && r.user_id === data.finalized_by)?.display_name;
  const rowItem = (r: MeetingAttendanceRow) => (
    <MeetingAttendanceRowItem
      key={r.participant_id}
      row={r}
      canEdit={canEdit}
      finalized={finalized}
      locale={i18n.language}
      onMark={(status: AttendanceStatus, note?: string) =>
        mark.mutate({ participantId: r.participant_id, status, note }, { onError })
      }
      onReset={() => clear.mutate(r.participant_id, { onError })}
    />
  );

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", density === "compact" && "px-4 py-3")}>
      <MeetingAttendanceSummary attendance={data} />
      {members.length === 0 ? (
        <p className="py-3 text-center text-caption text-muted-foreground">{t("meetings.governance.noMembers")}</p>
      ) : (
        <ul className="divide-y divide-border">{members.map(rowItem)}</ul>
      )}
      {observers.length > 0 ? (
        <Collapsible open={observersOpen} onOpenChange={setObserversOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-label text-muted-foreground hover:bg-surface-hover">
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform duration-fast motion-reduce:transition-none",
                !observersOpen && "-rotate-90",
              )}
            />
            {t("meetings.governance.observers", { count: observers.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="divide-y divide-border">{observers.map(rowItem)}</ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        {data.finalized_at ? (
          <p className="text-caption text-muted-foreground">
            {finalizerName
              ? t("meetings.governance.finalizedBy", { time: stampOf(data.finalized_at), name: finalizerName })
              : t("meetings.governance.finalized", { time: stampOf(data.finalized_at) })}
          </p>
        ) : (
          <span />
        )}
        {canEdit ? (
          finalized ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() =>
                reopen.mutate(undefined, {
                  onSuccess: () => toast.success(t("meetings.governance.reopenedToast")),
                  onError,
                })
              }
            >
              {t("meetings.governance.reopen")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="brand"
              disabled={finalize.isPending}
              onClick={() =>
                finalize.mutate(undefined, {
                  onSuccess: () => toast.success(t("meetings.governance.finalizedToast")),
                  onError,
                })
              }
            >
              {t("meetings.governance.finalize")}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
