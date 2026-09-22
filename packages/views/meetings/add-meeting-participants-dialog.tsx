"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { meetingKeys } from "@uniwork/core/meetings";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { Notice } from "../common/notice";
import { MemberMultiPicker } from "./member-multi-picker";
import { useMemberIndex } from "./use-member-index";

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
  const qc = useQueryClient();
  const { memberOf } = useMemberIndex(workspaceId);
  const [selected, setSelected] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setSelected([]);
      setFailedIds([]);
    }
    onOpenChange(next);
  };
  const failedNames = failedIds.map((userId) => memberOf(userId)?.display_name || t("meetings.formerMember"));

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
            const batch = [...selected];
            void Promise.allSettled(batch.map((userId) => inviteParticipant(meetingId, userId)))
              .then((results) => {
                const failed = batch.filter((_, i) => results[i]?.status === "rejected");
                const invited = batch.length - failed.length;
                // Whoever made it in shows on the roster now, not when the dialog closes.
                if (invited > 0) {
                  void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
                  void qc.invalidateQueries({ queryKey: meetingKeys.invitations(meetingId) });
                  toast.success(t("meetings.invitedMembers", { count: invited }));
                }
                if (failed.length > 0) {
                  // Keep only the people still to invite, so a retry does not re-send the rest.
                  setSelected(failed);
                  setFailedIds(failed);
                  return;
                }
                close(false);
              })
              .finally(() => setPending(false));
          }}
        >
          <FormDialogBody className="space-y-3">
            {failedIds.length > 0 ? (
              <Notice tone="destructive" icon={AlertCircle} layout="inline" live="assertive">
                {t("meetings.inviteFailedNames", { names: failedNames.join(", ") })}
              </Notice>
            ) : null}
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
