"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import { MemberMultiPicker } from "./member-multi-picker";

export function AddMeetingParticipantsDialog({
  workspaceId,
  meetingId,
  excludeUserIds,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  meetingId: string;
  excludeUserIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (!next) setSelected([]);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("meetings.addPeople")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (selected.length === 0) return;
            setPending(true);
            void Promise.allSettled(selected.map((userId) => inviteParticipant(meetingId, userId)))
              .then((results) => {
                const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
                if (failed) {
                  toastApiError(failed.reason, t("common.error"));
                  return;
                }
                toast.success(t("meetings.invitedMembers", { count: selected.length }));
                close(false);
              })
              .finally(() => setPending(false));
          }}
        >
          <MemberMultiPicker
            workspaceId={workspaceId}
            value={selected}
            onChange={setSelected}
            excludeUserIds={excludeUserIds}
            searchable
            className="min-h-0 flex-1"
          />
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || selected.length === 0}>
              {t("meetings.inviteMember")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
