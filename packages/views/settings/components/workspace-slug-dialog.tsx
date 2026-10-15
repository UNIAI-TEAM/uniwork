"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { isReservedSlug } from "@uniwork/core/paths";
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
import { isSlugConflict, isSlugLengthValid, SLUG_MAX_LENGTH, SLUG_REGEX } from "../../workspace/slug";
import { SettingsFieldError } from "./settings-layout";

/**
 * Confirms a slug change (spec §6.4). The URL moves by itself afterwards:
 * the mutation refetches the workspace under its old slug, the server
 * answers with the new one, and useDashboardGuard replaces the URL.
 */
export function WorkspaceSlugDialog({
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
  const current = workspace.slug;
  const [value, setValue] = useState(current);
  const [taken, setTaken] = useState(false);
  const errorId = useId();
  const next = value.trim().toLowerCase();
  const reserved = isReservedSlug(next);
  const valid = SLUG_REGEX.test(next) && isSlugLengthValid(next) && !reserved;
  const error = taken
    ? t("workspace.url_taken")
    : reserved
      ? t("workspace.url_reserved")
      : next !== "" && !valid
        ? t("workspace.url_invalid")
        : null;

  // Reset only on open: a refetch while the dialog is open must not eat what
  // the user is typing.
  useEffect(() => {
    if (!open) return;
    setValue(current);
    setTaken(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` is read on open only
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || next === current) return;
    try {
      await patch.mutateAsync({ wsId: workspace.id, slug: next });
      onOpenChange(false);
      toast.success(t("workspace.url_saved"));
    } catch (err) {
      if (isSlugConflict(err)) setTaken(true);
      else toastApiError(err, t("save.error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("workspace.url_dialog_title")}</DialogTitle>
            <DialogDescription>{t("workspace.url_dialog_body")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              value={value}
              // Room for spaces around the slug, which are trimmed.
              maxLength={SLUG_MAX_LENGTH + 2}
              autoComplete="off"
              className="font-mono"
              aria-label={t("workspace.url_new")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setTaken(false);
              }}
            />
            {error ? <SettingsFieldError id={errorId}>{error}</SettingsFieldError> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("workspace.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || next === current || patch.isPending}>
              {t("workspace.url_change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
