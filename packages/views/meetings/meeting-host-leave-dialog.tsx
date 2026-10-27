"use client";

import { useId, useMemo, useState } from "react";
import { useParticipants as useLiveKitParticipants } from "@livekit/components-react";
import { ArrowRightLeft, Crown, LogOut, PhoneOff, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore } from "@uniwork/core/auth";
import { useEndMeeting, useParticipants, useTransferHost } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../toast-api-error";
import { meetingLocale } from "./meeting-datetime";
import { dutyRole } from "./meeting-duty-menu-items";
import { handoverCandidates } from "./meeting-host-handover";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRoleChip } from "./meeting-role-chip";
import { useRoomAvatarOf, useRoomTintOf } from "./meeting-room-avatars";
import { humanParticipants, PARTICIPANT_IDENTITY_PREFIX, ROSTER_EVENTS } from "./meeting-signals";
import { usePendingJoinRequests } from "./use-pending-join-requests";

type Choice = "handover" | "end" | "leave";

const CARD =
  "group/card flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 font-normal transition-colors hover:bg-surface-hover has-[[data-checked]]:border-primary has-[[data-checked]]:bg-brand-subtle has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60 has-[[data-disabled]]:hover:bg-transparent";
const STAKE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium";

/**
 * Leave, as the person running the room: hand it to someone in it, end it for
 * everyone, or step out and keep it. What stepping out leaves behind (a
 * recording that keeps running, people still knocking) shows on that card.
 */
export function MeetingHostLeaveDialog({
  open,
  onOpenChange,
  meeting,
  workspaceId,
  recording,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting: Meeting;
  workspaceId: string;
  recording: boolean;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" closeLabel={t("common.close")}>
        {/* Mounted only while open: the roster it reads must not repaint the control bar. */}
        {open ? (
          <HostLeaveBody meeting={meeting} workspaceId={workspaceId} recording={recording} onLeave={onLeave} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HostLeaveBody({
  meeting,
  workspaceId,
  recording,
  onLeave,
}: {
  meeting: Meeting;
  workspaceId: string;
  recording: boolean;
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const viewerId = useAuthStore((s) => s.user?.id);
  // A workspace admin may end the meeting too, but only the host has a role to hand on.
  const isHost = Boolean(viewerId && viewerId === meeting.host_user_id);
  const room = useLiveKitParticipants({ updateOnlyOn: ROSTER_EVENTS });
  const people = useMemo(() => humanParticipants(room), [room]);
  const live = useMemo(() => new Set(people.map((p) => p.identity)), [people]);
  const liveName = useMemo(() => new Map(people.map((p) => [p.identity, p.name])), [people]);
  const alone = people.every((p) => p.isLocal);
  const { data: participants } = useParticipants(meeting.id);
  const locale = meetingLocale(i18n.language);
  const candidates = useMemo(
    () =>
      isHost
        ? handoverCandidates(participants ?? [], live, meeting.host_user_id, new Intl.Collator(locale, { sensitivity: "base" }))
        : [],
    [isHost, participants, live, meeting.host_user_id, locale],
  );
  const { count: waiting } = usePendingJoinRequests(meeting.id);
  const avatarOf = useRoomAvatarOf();
  const tintOf = useRoomTintOf();
  const transfer = useTransferHost(workspaceId, meeting.id);
  const end = useEndMeeting(workspaceId);
  const busy = transfer.isPending || end.isPending;

  // The default follows the room until the host picks: the roster may land after the dialog opens.
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice: Choice = picked ?? (candidates.length > 0 ? "handover" : alone ? "end" : "leave");
  const [pickedUser, setPickedUser] = useState<string | null>(null);
  const target = candidates.find((p) => p.user_id === pickedUser) ?? candidates[0];
  const nameOf = (p: { id: string; display_name_snapshot?: string }) =>
    liveName.get(PARTICIPANT_IDENTITY_PREFIX + p.id) || p.display_name_snapshot || "";

  const options: { value: Choice; icon: LucideIcon; tone: "brand" | "destructive" | "muted"; label: string; hint: string; disabled?: boolean }[] = [
    ...(isHost
      ? [
          {
            value: "handover" as const,
            icon: ArrowRightLeft,
            tone: "brand" as const,
            label: t("meetings.hostLeave.handover"),
            hint: candidates.length > 0 ? t("meetings.hostLeave.handoverHint") : t("meetings.hostLeave.handoverNobody"),
            disabled: candidates.length === 0,
          },
        ]
      : []),
    {
      value: "end",
      icon: PhoneOff,
      tone: "destructive",
      label: t("meetings.hostLeave.endAll"),
      hint: t("meetings.hostLeave.endAllHint"),
    },
    {
      value: "leave",
      icon: LogOut,
      tone: "muted",
      label: t("meetings.hostLeave.justLeave"),
      hint: isHost ? t("meetings.hostLeave.justLeaveHint") : t("meetings.hostLeave.justLeaveAdminHint"),
    },
  ];

  const confirm = () => {
    if (busy) return;
    if (choice === "leave") {
      onLeave();
      return;
    }
    // mutateAsync: ending closes the room, which can unmount this dialog before
    // the answer lands and drop mutate()'s per-call callbacks.
    if (choice === "end") {
      end.mutateAsync(meeting.id).then(onLeave, (err: unknown) => toastApiError(err, t("common.error")));
      return;
    }
    if (!target?.user_id) return;
    const name = nameOf(target);
    transfer.mutateAsync(target.user_id).then(
      () => {
        toast.success(t("meetings.hostTransferred", { name }));
        onLeave();
      },
      (err: unknown) => toastApiError(err, t("common.error")),
    );
  };

  const confirmLabel =
    choice === "handover" && target
      ? t("meetings.hostLeave.confirmHandover", { name: nameOf(target) })
      : choice === "end"
        ? t("meetings.confirmEnd")
        : t("meetings.confirmLeave");

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 border-b border-surface-border px-5 pt-5 pb-4 pr-12">
        <IconTile icon={isHost ? Crown : LogOut} tone={isHost ? "brand" : "muted"} shape="circle" />
        <span className="min-w-0 space-y-0.5">
          <DialogTitle>{isHost ? t("meetings.hostLeave.title") : t("meetings.leaveConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("meetings.hostLeave.description")}</DialogDescription>
        </span>
      </DialogHeader>

      <div className="max-h-[min(70dvh,32rem)] overflow-y-auto overscroll-contain px-5 py-4">
        <RadioGroup
          value={choice}
          onValueChange={(v) => setPicked(v as Choice)}
          aria-label={t("meetings.hostLeave.description")}
        >
          {options.map((o) => (
            <Label
              key={o.value}
              htmlFor={`${id}-${o.value}`}
              className={cn(
                CARD,
                o.tone === "destructive" &&
                  "has-[[data-checked]]:border-destructive has-[[data-checked]]:bg-destructive-soft",
              )}
            >
              <RadioGroupItem
                value={o.value}
                id={`${id}-${o.value}`}
                disabled={o.disabled}
                aria-describedby={`${id}-${o.value}-hint`}
                className={cn("mt-2", o.tone === "destructive" && "data-checked:border-destructive data-checked:bg-destructive dark:data-checked:bg-destructive")}
              />
              {/* The checked card takes the tile's own tint, so the tile lifts off it. */}
              <IconTile
                icon={o.icon}
                tone={o.tone}
                size="sm"
                shape="circle"
                className="group-has-[[data-checked]]/card:bg-background"
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-body font-medium text-foreground">{o.label}</span>
                <span id={`${id}-${o.value}-hint`} className="block text-caption text-muted-foreground">
                  {o.hint}
                </span>
                {o.value === "leave" && (recording || waiting > 0) ? (
                  <span className="flex flex-wrap gap-1.5 pt-1">
                    {recording ? (
                      <span className={cn(STAKE, "bg-destructive-soft text-destructive-soft-foreground")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-destructive-solid" />
                        {t("meetings.hostLeave.stakeRecording")}
                      </span>
                    ) : null}
                    {waiting > 0 ? (
                      <span className={cn(STAKE, "bg-warning-soft text-warning-soft-foreground")}>
                        <Users aria-hidden className="size-3" />
                        {t("meetings.hostLeave.stakeWaiting", { count: waiting })}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </Label>
          ))}
        </RadioGroup>

        {choice === "handover" && candidates.length > 0 ? (
          <section aria-labelledby={`${id}-pick`} className="mt-4">
            <h3 id={`${id}-pick`} className="mb-1.5 px-1 text-caption font-semibold text-muted-foreground">
              {t("meetings.hostLeave.pickLabel")}
            </h3>
            <RadioGroup
              value={target?.user_id ?? ""}
              onValueChange={(v) => setPickedUser(v as string)}
              aria-labelledby={`${id}-pick`}
              className="gap-0.5"
            >
              {candidates.map((p) => {
                const identity = PARTICIPANT_IDENTITY_PREFIX + p.id;
                const duty = dutyRole(p);
                return (
                  <Label
                    key={p.id}
                    htmlFor={`${id}-u-${p.id}`}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 font-normal transition-colors hover:bg-surface-hover has-[[data-checked]]:bg-brand-subtle"
                  >
                    <RadioGroupItem value={p.user_id ?? ""} id={`${id}-u-${p.id}`} />
                    <MeetingPersonAvatar name={nameOf(p)} avatarUrl={avatarOf(identity)} tint={tintOf(identity)} size={28} />
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">{nameOf(p)}</span>
                    {duty ? <MeetingRoleChip role={duty} className="shrink-0" /> : null}
                  </Label>
                );
              })}
            </RadioGroup>
          </section>
        ) : null}
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>{t("common.back")}</DialogClose>
        <Button
          type="button"
          variant={choice === "end" ? "destructive" : "default"}
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onClick={confirm}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
