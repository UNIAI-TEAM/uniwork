"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAdminMe,
  useCancelAdminOrganizationDeletion,
  useScheduleAdminOrganizationDeletion,
} from "@uniwork/core/admin";
import { apiErrorMessage } from "@uniwork/core/api";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { formatDateTime } from "./status-badge";
import { ReasonDialog } from "./reason-dialog";

export function OrganizationDeletionBanner({ scheduledAt, erased }: { scheduledAt: string | null; erased: boolean }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  if (erased) {
    return (
      <div role="status" className="border-b border-border bg-muted px-4 py-2 text-body text-muted-foreground">
        {t("erased_banner")}
      </div>
    );
  }
  if (!scheduledAt) return null;
  return (
    <div role="status" className="border-b border-border bg-destructive/10 px-4 py-2 text-body text-destructive">
      {t("scheduled_banner", { at: formatDateTime(scheduledAt, i18n.language) })}
    </div>
  );
}

export function OrganizationDeletionButton({
  orgId, name, slug, scheduledAt, erased,
}: {
  orgId: string;
  name: string;
  slug: string;
  scheduledAt: string | null;
  erased: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.detail" });
  const me = useAdminMe();
  const schedule = useScheduleAdminOrganizationDeletion(orgId);
  const cancel = useCancelAdminOrganizationDeletion(orgId);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pending = schedule.isPending || cancel.isPending;
  const scheduled = !erased && !!scheduledAt;
  const matched = draft.trim() === slug;
  if (me.data !== "admin") return null;

  const submit = async (reason: string) => {
    try {
      if (scheduled) {
        await cancel.mutateAsync(reason);
        toast.success(t("undo_delete_toast"));
      } else {
        await schedule.mutateAsync({ reason, confirm_slug: draft.trim() });
        toast.success(t("delete_toast"));
      }
      setOpen(false);
      setDraft("");
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? t("error_write"));
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={scheduled || erased ? "outline" : "destructive"}
        disabled={erased || pending}
        onClick={() => setOpen(true)}
      >
        {scheduled ? t("undo_delete") : (
          <>
            <Trash2 data-icon="inline-start" aria-hidden />
            {t("delete")}
          </>
        )}
      </Button>
      <ReasonDialog
        open={open && !erased}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraft("");
        }}
        title={scheduled ? t("undo_delete_title", { name }) : t("delete_title", { name })}
        description={scheduled ? t("undo_delete_description") : t("delete_description")}
        destructive={!scheduled}
        submitDisabled={!scheduled && !matched}
        pending={pending}
        onSubmit={(reason) => void submit(reason)}
      >
        {scheduled ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-delete-slug">{t("slug_label")}</Label>
            <Input
              id="admin-delete-slug"
              value={draft}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="admin-delete-slug-hint"
              onChange={(e) => setDraft(e.target.value)}
            />
            <p id="admin-delete-slug-hint" className="text-caption text-muted-foreground">
              {draft.trim().length > 0 && !matched ? t("slug_mismatch") : t("slug_hint", { slug })}
            </p>
          </div>
        )}
      </ReasonDialog>
    </>
  );
}
