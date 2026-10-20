"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@uniwork/ui/components/ui/switch";

/**
 * The "Share with workspace" row of the first-save dialog (UNI-2038 G4). Off by
 * default; an already-shared document shows it on and aria-disabled (turning
 * sharing off is the Share dialog's job, never this one's).
 */
export function FirstSaveShare({
  checked,
  alreadyShared,
  disabled,
  onChange,
}: {
  checked: boolean;
  alreadyShared: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const hintId = useId();
  const on = alreadyShared || checked;
  const locked = alreadyShared || disabled;
  const hint = alreadyShared
    ? t("documents.detail.first_save.share_already")
    : checked
      ? t("documents.detail.first_save.share_hint")
      : null;
  return (
    <div data-testid="first-save-share" className="flex flex-col gap-1.5">
      <label className="flex min-h-9 items-center justify-between gap-3 pointer-coarse:min-h-11">
        <span id={labelId} className="text-body leading-none font-medium">
          {t("documents.detail.first_save.share_toggle")}
        </span>
        <Switch
          checked={on}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          aria-disabled={locked || undefined}
          onCheckedChange={(next) => {
            if (!locked) onChange(next);
          }}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        />
      </label>
      {hint ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
