"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { usePatchWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError } from "./settings-layout";

/** Mirrors taskPrefixPattern in server/internal/service/workspace.go. */
const TASK_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** Confirms a task prefix change and shows what an identifier becomes (spec §6.4). */
export function WorkspaceTaskPrefixDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const patch = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const current = workspace.task_prefix ?? "";
  const [value, setValue] = useState(current);
  const errorId = useId();
  const next = value.trim().toUpperCase();
  const valid = TASK_PREFIX_PATTERN.test(next);
  const invalid = next !== "" && !valid;

  // Reset only on open: a refetch while the dialog is open must not eat what
  // the user is typing.
  useEffect(() => {
    if (open) setValue(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` is read on open only
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || next === current) return;
    try {
      await patch.mutateAsync({ wsId: workspace.id, task_prefix: next });
      onOpenChange(false);
      toast.success(t("workspace.task_prefix_saved"));
    } catch (err) {
      toastApiError(err, t("save.error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("workspace.task_prefix_dialog_title")}</DialogTitle>
            <DialogDescription>{t("workspace.task_prefix_dialog_body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={value}
              maxLength={10}
              autoComplete="off"
              className="uppercase"
              aria-label={t("workspace.task_prefix_new")}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="font-mono text-caption text-muted-foreground">
              {t("workspace.task_prefix_preview", { from: `${current}-12`, to: `${valid ? next : current}-12` })}
            </p>
            {invalid ? <SettingsFieldError id={errorId}>{t("workspace.task_prefix_invalid")}</SettingsFieldError> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("workspace.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || next === current || patch.isPending}>
              {t("workspace.task_prefix_change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
