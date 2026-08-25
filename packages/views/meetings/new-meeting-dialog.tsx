"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateMeeting } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function NewMeetingDialog({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const create = useCreateMeeting(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("meetings.new")}</Button>} />
      <DialogContent title={t("meetings.new")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                title,
                starts_at: new Date(start).toISOString(),
                ends_at: new Date(end).toISOString(),
              },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          <div>
            <Label htmlFor="m-title">{t("meetings.meetingTitle")}</Label>
            <Input
              id="m-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="m-start">{t("meetings.startsAt")}</Label>
            <Input
              id="m-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="m-end">{t("meetings.endsAt")}</Label>
            <Input
              id="m-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </div>
          {create.error && <p className="text-[13px] text-danger">{t("common.error")}</p>}
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
