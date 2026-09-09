"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateTask } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function NewTaskDialog({
  workspaceId,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  workspaceId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const { t } = useTranslation();
  const create = useCreateTask(workspaceId);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [title, setTitle] = useState("");
  const open = openProp ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger render={<Button size="sm">{t("tasks.new")}</Button>} />
      ) : null}
      <DialogContent>
        <DialogTitle>{t("tasks.new")}</DialogTitle>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { title },
              {
                onSuccess: () => {
                  setTitle("");
                  setOpen(false);
                },
              },
            );
          }}
        >
          <div>
            <Label htmlFor="task-title">{t("tasks.taskTitle")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t("common.create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
