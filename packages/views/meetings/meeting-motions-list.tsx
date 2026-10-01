"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingClerk } from "@uniwork/core/meetings/attendance";
import { useCloseMotion, useDeleteMotion, useMeetingMotions, useUpdateMotion } from "@uniwork/core/meetings/motions";
import type { Meeting, MeetingMotion } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { MeetingMotionCard } from "./meeting-motion-card";
import { MeetingMotionFormDialog } from "./meeting-motion-form-dialog";
import { MeetingMotionOpenDialog } from "./meeting-motion-open-dialog";
import { MeetingRowsSkeleton, MeetingSectionError } from "./meeting-section-state";

type ConfirmTarget = { kind: "delete" | "close"; motion: MeetingMotion };

/** Members on the roll frozen at opening who have not voted yet; 0 when unknown. */
function missingBallots(motion: MeetingMotion): number {
  return Math.max(0, (motion.roll_size ?? 0) - (motion.cast_count ?? 0));
}

/**
 * The vote items of one meeting, shared by the room tab and the detail page.
 * It loads them, works out who clerks, and owns every dialog (draft form,
 * open, delete and close confirmations) so the cards stay presentational.
 * Drafts reorder among themselves; ballots are cast only where `canVote` is set.
 */
export function MeetingMotionsList({
  meeting,
  meetingId,
  workspaceId,
  canVote,
  density,
}: {
  /** Absent for a guest in the room; guests never clerk. */
  meeting?: Meeting;
  meetingId: string;
  workspaceId?: string;
  canVote: boolean;
  density: "room" | "compact";
}) {
  const { t } = useTranslation();
  const { data: motions, isPending, isError, refetch } = useMeetingMotions(meetingId);
  const { isClerk } = useMeetingClerk(meeting ?? null, workspaceId ?? "");
  const update = useUpdateMotion(meetingId);
  const remove = useDeleteMotion(meetingId);
  const close = useCloseMotion(meetingId);
  // Each dialog keeps its last motion while it animates out, so its words do
  // not change on the way out.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingMotion | undefined>(undefined);
  const [openTarget, setOpenTarget] = useState<MeetingMotion | null>(null);
  const [openConfirmOpen, setOpenConfirmOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const onError = (err: unknown) => toastApiError(err, t("common.error"));

  if (isPending) return <MeetingRowsSkeleton rows={2} className={density === "compact" ? "py-1" : undefined} />;
  if (isError || !motions) {
    return (
      <MeetingSectionError
        className={density === "compact" ? "m-4" : undefined}
        message={t("meetings.governance.motionsLoadFailed")}
        onRetry={() => void refetch()}
      />
    );
  }

  const inProgress = meeting?.status === "IN_PROGRESS";
  const canAdd = isClerk && (meeting?.status === "SCHEDULED" || inProgress);
  const anotherOpen = motions.some((m) => m.status === "OPEN");
  const drafts = motions.filter((m) => m.status === "DRAFT");

  const ask = (kind: ConfirmTarget["kind"], motion: MeetingMotion) => {
    setConfirm({ kind, motion });
    setConfirmOpen(true);
  };
  const move = (motion: MeetingMotion, direction: "up" | "down") => {
    const neighbour = drafts[drafts.indexOf(motion) + (direction === "up" ? -1 : 1)];
    if (!neighbour) return;
    // The server swaps with whichever draft holds the requested slot.
    update.mutate({ motionId: motion.id, position: neighbour.position }, { onError });
  };
  const runConfirmed = () => {
    if (!confirm) return;
    const done = (message: string) => {
      setConfirmOpen(false);
      toast.success(message);
    };
    if (confirm.kind === "delete") {
      remove.mutate(confirm.motion.id, { onSuccess: () => done(t("meetings.governance.motionDeleted")), onError });
    } else {
      close.mutate(confirm.motion.id, { onSuccess: () => done(t("meetings.governance.motionClosedToast")), onError });
    }
  };
  const missing = confirm?.kind === "close" ? missingBallots(confirm.motion) : 0;
  const closeDescription =
    missing > 0
      ? `${t("meetings.governance.motionCloseMissing", { count: missing })} ${t("meetings.governance.motionCloseConfirm")}`
      : t("meetings.governance.motionCloseConfirm");

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", density === "compact" && "px-4 py-4")}>
      {motions.length === 0 ? (
        <p className="py-2 text-caption text-muted-foreground">
          {isClerk ? t("meetings.governance.motionsEmptyClerk") : t("meetings.governance.motionsEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {motions.map((m) => {
            const draftIndex = drafts.indexOf(m);
            return (
              <li key={m.id} className="min-w-0">
                <MeetingMotionCard
                  meetingId={meetingId}
                  motion={m}
                  isClerk={isClerk}
                  canVote={canVote}
                  inProgress={inProgress}
                  anotherOpen={anotherOpen}
                  canMoveUp={draftIndex > 0}
                  canMoveDown={draftIndex >= 0 && draftIndex < drafts.length - 1}
                  onEdit={() => {
                    setEditing(m);
                    setFormOpen(true);
                  }}
                  onDelete={() => ask("delete", m)}
                  onMove={(direction) => move(m, direction)}
                  onOpen={() => {
                    setOpenTarget(m);
                    setOpenConfirmOpen(true);
                  }}
                  onClose={() => ask("close", m)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {canAdd ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus aria-hidden className="size-4" />
            {t("meetings.governance.motionAdd")}
          </Button>
        </div>
      ) : null}
      {/* The dialog keys its form by motion id, so "add" after an edit starts fresh. */}
      <MeetingMotionFormDialog meetingId={meetingId} open={formOpen} onOpenChange={setFormOpen} motion={editing} />
      {openTarget ? (
        <MeetingMotionOpenDialog
          meeting={meeting}
          meetingId={meetingId}
          motion={openTarget}
          open={openConfirmOpen}
          onOpenChange={setOpenConfirmOpen}
        />
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          confirm?.kind === "delete"
            ? t("meetings.governance.motionDeleteConfirmTitle")
            : t("meetings.governance.motionCloseConfirmTitle")
        }
        description={
          confirm?.kind === "delete"
            ? t("meetings.governance.motionDeleteConfirm", { title: confirm.motion.title })
            : closeDescription
        }
        confirmLabel={
          confirm?.kind === "delete" ? t("meetings.governance.motionDelete") : t("meetings.governance.motionClose")
        }
        destructive={confirm?.kind === "delete"}
        pending={remove.isPending || close.isPending}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
