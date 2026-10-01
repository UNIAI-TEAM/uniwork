"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleDashed, Lock } from "lucide-react";
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
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { MeetingAttendanceAddedLater } from "./meeting-attendance-added-later";
import { MeetingAttendanceRowItem } from "./meeting-attendance-row";
import { MeetingAttendanceSummary } from "./meeting-attendance-summary";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";
import { useMemberIndex } from "./use-member-index";

/**
 * The formal roll: where it stands (open or finalized), members with their
 * suggested or marked status, observers folded below, and finalize/reopen for
 * whoever clerks. A finalized roll is locked until it is reopened.
 */
export function MeetingAttendancePanel({
  meeting,
  workspaceId,
  canEdit,
  density,
  query = "",
}: {
  meeting: Meeting;
  workspaceId: string;
  canEdit: boolean;
  density: "room" | "compact";
  /** Narrows the rows by name, e.g. from the room tab's search field. */
  query?: string;
}) {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, refetch } = useMeetingAttendance(meeting.id);
  const { memberOf } = useMemberIndex(workspaceId);
  const mark = useMarkAttendance(meeting.id);
  const clear = useClearAttendanceMark(meeting.id);
  const finalize = useFinalizeAttendance(meeting.id);
  const reopen = useReopenAttendance(meeting.id);
  const [observersOpen, setObserversOpen] = useState(false);
  // The dialog keeps its last kind while it animates out, so its words do not
  // flip to the other action on the way out.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirm, setConfirm] = useState<"finalize" | "reopen">("finalize");
  const onError = (err: unknown) => toastApiError(err, t("common.error"));
  const formatTime = useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
    return (iso: string) => f.format(new Date(iso));
  }, [i18n.language]);
  // Finalize and reopen swap the footer button, and the dialog hands focus
  // back to a button that is about to go away; follow the swap to the new one.
  const footerAction = useRef<HTMLButtonElement>(null);
  // The state the roll should reach before focus follows; null when nothing waits.
  const refocusWhenFinal = useRef<boolean | null>(null);
  const isFinal = Boolean(data?.finalized_at);
  useEffect(() => {
    if (refocusWhenFinal.current === null || refocusWhenFinal.current !== isFinal) return;
    refocusWhenFinal.current = null;
    footerAction.current?.focus();
  }, [isFinal]);

  if (isPending) return <MeetingRowsSkeleton rows={3} className="py-1" />;
  if (isError || !data) {
    return <MeetingSectionError message={t("meetings.governance.loadFailed")} onRetry={() => void refetch()} />;
  }
  const finalized = Boolean(data.finalized_at);
  const editable = canEdit && !finalized;
  const needle = query.trim().toLocaleLowerCase(i18n.language);
  const shown = needle
    ? data.rows.filter((r) => r.display_name.toLocaleLowerCase(i18n.language).includes(needle))
    : data.rows;
  // A finalized roll is a snapshot: people added since have no mark and wait,
  // apart, for the roll to be reopened.
  const addedLater = finalized ? shown.filter((r) => r.joined_after_finalize) : [];
  const onRoll = finalized ? shown.filter((r) => !r.joined_after_finalize) : shown;
  const members = onRoll.filter((r) => r.standing === "MEMBER");
  const observers = onRoll.filter((r) => r.standing !== "MEMBER");
  // A roll read days later needs the date as well as the time.
  const stampOf = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" }).format(
      new Date(iso),
    );
  // The finalizer is usually on the roll; an admin who is not falls back to the time alone.
  const finalizerName = data.rows.find((r) => r.user_id && r.user_id === data.finalized_by)?.display_name;
  const rowItem = (r: MeetingAttendanceRow) => (
    <MeetingAttendanceRowItem
      key={r.participant_id}
      row={r}
      editable={editable}
      formatTime={formatTime}
      avatarUrl={r.user_id ? memberOf(r.user_id)?.avatar_url : undefined}
      onMark={(status: AttendanceStatus, note?: string) =>
        mark.mutateAsync({ participantId: r.participant_id, status, note }).catch((err: unknown) => {
          onError(err);
          throw err;
        })
      }
      onReset={() => clear.mutate(r.participant_id, { onError })}
    />
  );
  const runConfirmed = () => {
    const done = () => {
      refocusWhenFinal.current = confirm === "finalize";
      setConfirmOpen(false);
    };
    if (confirm === "finalize") {
      finalize.mutate(undefined, {
        onSuccess: () => {
          done();
          toast.success(t("meetings.governance.finalizedToast"));
        },
        onError,
      });
    } else {
      reopen.mutate(undefined, {
        onSuccess: () => {
          done();
          toast.success(t("meetings.governance.reopenedToast"));
        },
        onError,
      });
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", density === "compact" && "px-4 py-4")}>
      <p
        className={cn(
          "flex items-start gap-2 rounded-lg px-3 py-2 text-caption",
          finalized ? "bg-success-soft text-success-soft-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {finalized ? (
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <CircleDashed aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>
          {finalized && data.finalized_at
            ? finalizerName
              ? t("meetings.governance.finalizedBy", { time: stampOf(data.finalized_at), name: finalizerName })
              : t("meetings.governance.finalized", { time: stampOf(data.finalized_at) })
            : canEdit
              ? t("meetings.governance.draftNoticeClerk")
              : t("meetings.governance.draftNotice")}
          {finalized && canEdit ? ` ${t("meetings.governance.lockedHint")}` : null}
        </span>
      </p>
      <MeetingAttendanceSummary attendance={data} />
      {members.length > 0 ? (
        <ul className="-mx-2 divide-y divide-border">{members.map(rowItem)}</ul>
      ) : needle ? (
        // A search that only finds observers shows them below without a "no match" line above them.
        observers.length === 0 && addedLater.length === 0 ? (
          <p className="py-3 text-center text-caption text-muted-foreground">{t("meetings.noPeopleMatch")}</p>
        ) : null
      ) : (
        <p className="py-3 text-center text-caption text-muted-foreground">{t("meetings.governance.noMembers")}</p>
      )}
      {observers.length > 0 && needle ? (
        // While searching, matching observers are simply listed: a forced-open
        // collapsible would have a trigger that does nothing.
        <section aria-label={t("meetings.governance.observers", { count: observers.length })}>
          <p className="px-1 py-1 text-label text-muted-foreground">
            {t("meetings.governance.observers", { count: observers.length })}
          </p>
          <ul className="-mx-2 divide-y divide-border">{observers.map(rowItem)}</ul>
        </section>
      ) : observers.length > 0 ? (
        <Collapsible open={observersOpen} onOpenChange={setObserversOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left pointer-coarse:min-h-11 text-label text-muted-foreground transition-colors duration-fast hover:bg-surface-hover hover:text-foreground">
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
            <ul className="-mx-2 divide-y divide-border">{observers.map(rowItem)}</ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {addedLater.length > 0 ? (
        <MeetingAttendanceAddedLater count={addedLater.length}>{addedLater.map(rowItem)}</MeetingAttendanceAddedLater>
      ) : null}
      {canEdit ? (
        <div className="flex justify-end border-t border-border pt-3">
          {finalized ? (
            <Button
              ref={footerAction}
              type="button"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() => {
                setConfirm("reopen");
                setConfirmOpen(true);
              }}
            >
              {t("meetings.governance.reopen")}
            </Button>
          ) : (
            <Button
              ref={footerAction}
              type="button"
              variant="brand"
              disabled={finalize.isPending}
              onClick={() => {
                setConfirm("finalize");
                setConfirmOpen(true);
              }}
            >
              <Lock aria-hidden className="size-4" />
              {t("meetings.governance.finalize")}
            </Button>
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          confirm === "reopen" ? t("meetings.governance.reopenConfirmTitle") : t("meetings.governance.finalizeConfirmTitle")
        }
        description={confirm === "reopen" ? t("meetings.governance.reopenConfirm") : t("meetings.governance.finalizeConfirm")}
        confirmLabel={confirm === "reopen" ? t("meetings.governance.reopen") : t("meetings.governance.finalize")}
        destructive={false}
        pending={finalize.isPending || reopen.isPending}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
