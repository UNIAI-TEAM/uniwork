"use client";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { inviteParticipant } from "@uniwork/core/api/endpoints/meetings";
import { useCreateInstantMeeting } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
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
  const userId = useAuthStore((s) => s.user?.id);
  const instant = useCreateInstantMeeting(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              {t("meetings.instant")}
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto">
        <DialogTitle>{t("meetings.instant")}</DialogTitle>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            instant.mutate(title.trim() || undefined, {
              onSuccess: async (m) => {
                if (!m) {
                  toast.error(t("common.error"));
                  return;
                }
                setOpen(false);
                onStarted(m.id);
                if (attendees.length) {
                  const results = await Promise.allSettled(
                    attendees.map((id) => inviteParticipant(m.id, id)),
                  );
                  if (results.some((r) => r.status === "rejected"))
                    toast.error(t("common.error"));
                }
              },
              onError: () => toast.error(t("common.error")),
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="instant-title">
                {t("meetings.instantTitle")}
              </FieldLabel>
              <Input
                id="instant-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <FieldDescription>{t("meetings.instantHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("meetings.attendees")}</FieldLabel>
              <MemberMultiPicker
                workspaceId={workspaceId}
                value={attendees}
                onChange={setAttendees}
                excludeUserIds={userId ? [userId] : []}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button type="submit" disabled={instant.isPending}>
              {t("meetings.instant")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
