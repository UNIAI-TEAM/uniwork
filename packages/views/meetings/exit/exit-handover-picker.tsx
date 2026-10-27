"use client";

import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTransferHost } from "@uniwork/core/meetings";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../../toast-api-error";
import { meetingLocale } from "../meeting-datetime";
import { dutyRole } from "../meeting-duty-menu-items";
import { handoverCandidates } from "../meeting-host-handover";
import { MeetingPersonAvatar } from "../meeting-person";
import { MeetingRoleChip } from "../meeting-role-chip";
import { useRoomAvatarOf, useRoomTintOf } from "../meeting-room-avatars";
import { PARTICIPANT_IDENTITY_PREFIX } from "../meeting-signals";

/**
 * "Chuyển quyền…" from outside the room: the same people the in-room dialog
 * offers (workspace people in the room now, the secretary first). The server
 * refuses someone who left meanwhile; the roster is asked again then.
 */
export function ExitHandoverPicker({
  open,
  onOpenChange,
  meeting,
  workspaceId,
  participants,
  onHandedOver,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting: Meeting;
  workspaceId: string;
  participants: readonly MeetingParticipant[];
  onHandedOver: (userId: string, name: string) => void;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const avatarOf = useRoomAvatarOf();
  const tintOf = useRoomTintOf();
  const transfer = useTransferHost(workspaceId, meeting.id);
  const locale = meetingLocale(i18n.language);
  const candidates = useMemo(() => {
    const live = new Set(participants.filter((p) => p.in_room === true).map((p) => PARTICIPANT_IDENTITY_PREFIX + p.id));
    return handoverCandidates(participants, live, meeting.host_user_id, new Intl.Collator(locale, { sensitivity: "base" }));
  }, [participants, meeting.host_user_id, locale]);
  const [picked, setPicked] = useState<string | null>(null);
  const target = candidates.find((p) => p.user_id === picked) ?? candidates[0];
  const name = target?.display_name_snapshot ?? "";

  const confirm = () => {
    if (!target?.user_id || transfer.isPending) return;
    const userId = target.user_id;
    transfer.mutateAsync(userId).then(
      () => onHandedOver(userId, name),
      (err: unknown) => {
        toastApiError(err, t("common.error"));
        onRefresh();
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" closeLabel={t("common.close")}>
        <DialogHeader className="border-b border-surface-border px-5 pt-5 pb-4 pr-12">
          <DialogTitle id={`${id}-title`}>{t("meetings.exit.handover.pickTitle")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[min(60dvh,24rem)] overflow-y-auto px-5 py-4">
          {candidates.length === 0 ? (
            <p className="text-body text-muted-foreground">{t("meetings.hostLeave.handoverNobody")}</p>
          ) : (
            <RadioGroup
              value={target?.user_id ?? ""}
              onValueChange={(v) => setPicked(v as string)}
              aria-labelledby={`${id}-title`}
              className="gap-0.5"
            >
              {candidates.map((p) => {
                const identity = PARTICIPANT_IDENTITY_PREFIX + p.id;
                const duty = dutyRole(p);
                return (
                  <Label
                    key={p.id}
                    htmlFor={`${id}-${p.id}`}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 font-normal transition-colors hover:bg-surface-hover has-[[data-checked]]:bg-brand-subtle"
                  >
                    <RadioGroupItem value={p.user_id ?? ""} id={`${id}-${p.id}`} />
                    <MeetingPersonAvatar
                      name={p.display_name_snapshot ?? ""}
                      avatarUrl={avatarOf(identity)}
                      tint={tintOf(identity)}
                      size={28}
                    />
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">{p.display_name_snapshot}</span>
                    {duty ? <MeetingRoleChip role={duty} className="shrink-0" /> : null}
                  </Label>
                );
              })}
            </RadioGroup>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>{t("common.back")}</DialogClose>
          {target ? (
            <Button
              type="button"
              aria-disabled={transfer.isPending || undefined}
              aria-busy={transfer.isPending || undefined}
              onClick={confirm}
            >
              {transfer.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("meetings.exit.handover.pickConfirm", { name })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
