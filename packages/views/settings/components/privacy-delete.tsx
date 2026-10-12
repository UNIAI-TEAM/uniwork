"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCreatePrivacyDeletion, useCancelPrivacyDeletion, usePrivacyExports } from "@uniwork/core/privacy";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../../toast-api-error";
import { EventTime } from "../../audit/event-presenter";
import {
  SettingsBadge,
  type SettingsBadgeTone,
  SettingsDangerZone,
  SettingsRow,
} from "./settings-layout";

const STATUS_TONE: Record<string, SettingsBadgeTone> = {
  pending: "info",
  running: "info",
  done: "success",
  failed: "destructive",
};

function DeletionBadge({ status }: { status: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy.export.status" });
  const label = t(status, { defaultValue: t("unknown") });
  const icon =
    status === "pending" || status === "running" ? (
      <Spinner />
    ) : status === "failed" ? (
      <CircleAlert aria-hidden />
    ) : status === "done" ? (
      <Check aria-hidden />
    ) : null;
  return (
    <SettingsBadge tone={STATUS_TONE[status] ?? "muted"} icon={icon}>
      {label}
    </SettingsBadge>
  );
}

export function PrivacyDelete({ orgId, slug }: { orgId: string; slug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.privacy.delete" });
  const exports = usePrivacyExports(orgId);
  const remove = useCreatePrivacyDeletion(orgId);
  const cancel = useCancelPrivacyDeletion(orgId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const latest = exports.data?.find((job) => job.kind === "delete");
  const scheduled = latest?.status === "scheduled";
  const failed = latest?.status === "failed";
  const running = exports.data?.some((job) => job.status === "pending" || job.status === "running") ?? false;
  const matched = draft.trim() === slug;

  return (
    <SettingsDangerZone title={t("title")} description={t("description")}>
      <SettingsRow
        label={t("label")}
        description={
          <>
            {running ? t("blocked") : scheduled ? t("scheduled") : failed ? t("failed") : t("hint")}
            {scheduled && latest?.erases_at ? (
              <span className="mt-2 block">
                <EventTime iso={latest.erases_at} />
              </span>
            ) : null}
            {latest ? (
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span>{t("progress")}</span>
                <DeletionBadge status={latest.status} />
              </span>
            ) : null}
          </>
        }
        align="start"
        size="none"
      >
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setDraft("");
          }}
        >
          <DialogTrigger render={<Button variant="destructive" disabled={running || scheduled || remove.isPending} />}>
            <Trash2 data-icon="inline-start" aria-hidden />
            {t("open")}
          </DialogTrigger>
          <DialogContent>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!matched || running || remove.isPending) return;
                remove.mutate(slug, {
                  onSuccess: () => {
                    setOpen(false);
                    setDraft("");
                    toast.success(t("queued"));
                  },
                  onError: (err) => toastApiError(err, t("create_failed")),
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("dialog_title")}</DialogTitle>
                <DialogDescription>{t("body")}</DialogDescription>
              </DialogHeader>
              <div className="my-4 grid gap-1.5">
                <Label htmlFor="privacy-delete-slug">{t("slug_label")}</Label>
                <Input
                  id="privacy-delete-slug"
                  value={draft}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby="privacy-delete-hint"
                  onChange={(e) => setDraft(e.target.value)}
                />
                <p id="privacy-delete-hint" className="text-caption text-muted-foreground">
                  {draft.trim().length > 0 && !matched ? t("mismatch") : t("slug_hint", { slug })}
                </p>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" type="button" />}>{t("cancel")}</DialogClose>
                <Button type="submit" variant="destructive" disabled={!matched || running || remove.isPending}>
                  {remove.isPending ? (
                    <Spinner data-icon="inline-start" aria-label={t("confirm")} />
                  ) : (
                    <Trash2 data-icon="inline-start" aria-hidden />
                  )}
                  {t("confirm")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        {scheduled ? (
          <Button
            type="button"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(undefined, {
                onSuccess: () => toast.success(t("cancel_done")),
                onError: (err) => toastApiError(err, t("cancel_failed")),
              });
            }}
          >
            {cancel.isPending ? <Spinner data-icon="inline-start" aria-label={t("cancel_action")} /> : null}
            {t("cancel_action")}
          </Button>
        ) : null}
      </SettingsRow>
    </SettingsDangerZone>
  );
}
