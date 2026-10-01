"use client";
import { TriangleAlert, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { attendanceQuorum, useMeetingAttendance } from "@uniwork/core/meetings/attendance";
import { useOpenMotion } from "@uniwork/core/meetings/motions";
import type { Meeting, MeetingMotion } from "@uniwork/core/types/meeting";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { toastApiError } from "../toast-api-error";

/**
 * The last look before a vote opens: who will be on the roll (members present
 * or late, frozen at this moment), a warning when nobody is or when the
 * minimum attendance is not met, and that late joiners cannot vote on it.
 * Opening is still allowed in both cases: the clerk decides. Composed from
 * the AlertDialog parts because ConfirmDialog takes a plain description only.
 */
export function MeetingMotionOpenDialog({
  meeting,
  meetingId,
  motion,
  open,
  onOpenChange,
}: {
  /** Absent in guest mode, where nobody clerks; the roll is not loaded then. */
  meeting?: Meeting;
  meetingId: string;
  motion: MeetingMotion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data, isError } = useMeetingAttendance(meetingId, open && Boolean(meeting));
  const openMotion = useOpenMotion(meetingId);
  const q = data ? attendanceQuorum(data) : null;

  const confirm = () => {
    if (openMotion.isPending) return;
    openMotion.mutateAsync(motion.id).then(
      () => {
        toast.success(t("meetings.governance.motionOpenedToast"));
        onOpenChange(false);
      },
      (err: unknown) => toastApiError(err, t("common.error")),
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("meetings.governance.motionOpenConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("meetings.governance.motionOpenFinal")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2.5">
          <p className="text-body font-medium text-pretty text-foreground">
            {t("meetings.governance.activityMotionDetail", { title: motion.title })}
          </p>
          {q ? (
            <p className="text-body text-foreground tabular-nums">
              {t("meetings.governance.motionOpenRoll", { count: q.attended })}
            </p>
          ) : meeting && !isError ? (
            <Skeleton className="h-4 w-48" />
          ) : null}
          {q && q.attended === 0 ? (
            <Notice tone="warning" icon={UserX} layout="inline">
              {t("meetings.governance.motionOpenNoVoters")}
            </Notice>
          ) : q && q.required !== null && q.missing > 0 ? (
            <Notice tone="warning" icon={TriangleAlert} layout="inline">
              {t("meetings.governance.motionOpenQuorumWarning", { required: q.required })}
            </Notice>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={openMotion.isPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={openMotion.isPending}
            aria-busy={openMotion.isPending || undefined}
            onClick={confirm}
          >
            {t("meetings.governance.motionOpen")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
