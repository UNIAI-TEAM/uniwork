"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
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

  const nothingPicked = selected.length === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("meetings.addPeople")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nothingPicked) return;
            setPending(true);
            void Promise.allSettled(selected.map((userId) => inviteParticipant(meetingId, userId)))
              .then((results) => {
                const failed = results.filter((r) => r.status === "rejected").length;
                if (failed) {
                  toast.error(t("meetings.inviteFailedCount", { count: failed }));
                  return;
                }
                toast.success(t("meetings.invitedMembers", { count: selected.length }));
                close(false);
              })
              .finally(() => setPending(false));
          }}
        >
          <FormDialogBody>
            <MemberMultiPicker
              workspaceId={workspaceId}
              value={selected}
              onChange={setSelected}
              excludeUserIds={excludeUserIds}
              searchable
            />
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => close(false)}
            submitType="submit"
            submitLabel={t("meetings.inviteMember")}
            submittingLabel={t("meetings.inviting")}
            submitting={pending}
            submitDisabled={nothingPicked}
            leading={nothingPicked ? t("meetings.pickPeopleToInvite") : undefined}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
