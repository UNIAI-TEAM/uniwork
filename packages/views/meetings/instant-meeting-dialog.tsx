"use client";
import { useId, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { useCreateInstantMeeting } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { MemberMultiPicker } from "./member-multi-picker";

export function InstantMeetingDialog({
  workspaceId,
  onStarted,
  trigger,
}: {
  workspaceId: string;
  onStarted: (meetingId: string) => void;
  trigger?: ReactElement;
}) {
  const { t } = useTranslation();
  const id = useId();
  const userId = useAuthStore((s) => s.user?.id);
  const instant = useCreateInstantMeeting(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTitle("");
      setAttendees([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              {t("meetings.instant")}
            </Button>
          )
        }
      />
      <FormDialogContent size="md">
        <FormDialogHeader title={t("meetings.instant")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // The picks go with this start; the form clears as soon as the room opens.
            const invitees = attendees;
            instant.mutate(title.trim() || undefined, {
              onSuccess: async (m) => {
                if (!m) {
                  toast.error(t("common.error"));
                  return;
                }
                changeOpen(false);
                onStarted(m.id);
                if (invitees.length) {
                  const results = await Promise.allSettled(
                    invitees.map((userId) => inviteParticipant(m.id, userId)),
                  );
                  const failed = results.filter((r) => r.status === "rejected").length;
                  if (failed) toast.error(t("meetings.inviteFailedCount", { count: failed }));
                }
              },
              onError: (err) => toastApiError(err, t("common.error")),
            });
          }}
        >
          <FormDialogBody>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor={`${id}-title`}>{t("meetings.instantTitle")}</FieldLabel>
                <Input
                  id={`${id}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-describedby={`${id}-hint`}
                  autoFocus
                />
                <FieldDescription id={`${id}-hint`}>{t("meetings.instantHint")}</FieldDescription>
              </Field>
              <Field aria-labelledby={`${id}-attendees`}>
                <FieldLabel id={`${id}-attendees`}>{t("meetings.attendees")}</FieldLabel>
                <MemberMultiPicker
                  workspaceId={workspaceId}
                  value={attendees}
                  onChange={setAttendees}
                  excludeUserIds={userId ? [userId] : []}
                />
              </Field>
            </FieldGroup>
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => changeOpen(false)}
            submitType="submit"
            submitLabel={t("meetings.instant")}
            submittingLabel={t("meetings.starting")}
            submitting={instant.isPending}
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
