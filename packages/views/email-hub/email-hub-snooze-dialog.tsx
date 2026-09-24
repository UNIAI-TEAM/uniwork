"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { toDateOnly } from "../common/date-field";
import { DateTimeField } from "../common/datetime-field";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";

/** Snooze until a moment of the reader's choosing; the two presets cover the common cases. */
export function EmailHubSnoozeDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: (when: Date) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const when = value ? new Date(value) : null;
  const valid = !!when && !Number.isNaN(when.getTime());
  const past = valid && when.getTime() <= Date.now() + 60_000;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <FormDialogContent>
        <FormDialogHeader title={t("email_hub.snooze.custom_title")} description={t("email_hub.snooze.custom_body")} />
        <FormDialogBody>
          <DateTimeField
            value={value}
            onChange={setValue}
            minDate={toDateOnly(new Date())}
            hourLabel={t("common.hour")}
            minuteLabel={t("common.minute")}
          />
          {past ? <p className="text-caption text-destructive">{t("email_hub.snooze.custom_past")}</p> : null}
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("email_hub.snooze.action")}
          submitting={pending}
          submitDisabled={!valid || past}
          onSubmit={() => {
            if (when && valid && !past) onConfirm(when);
          }}
        />
      </FormDialogContent>
    </Dialog>
  );
}
