"use client";

import { useId } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuCheckboxItem } from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";

export interface RestrictedToggleProps {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  /** The open folder is already restricted: shown on and locked, nothing is sent. */
  locked?: boolean;
  className?: string;
}

/**
 * The one-tap "Restricted" switch on the create cards and the upload dialog
 * (DOC-02): a button with `aria-pressed`. Locked inside a restricted folder it
 * stays in the tab order (`aria-disabled`, never `disabled`) and says why.
 */
export function RestrictedToggle({ pressed, onPressedChange, locked = false, className }: RestrictedToggleProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const on = pressed || locked;
  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <button
        type="button"
        aria-pressed={on}
        aria-disabled={locked || undefined}
        aria-describedby={hintId}
        title={locked ? undefined : t("documents.home.create.restricted_toggle_hint")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-caption font-medium transition-colors pointer-coarse:min-h-11 aria-disabled:cursor-not-allowed",
          on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent/40",
        )}
        onClick={() => {
          if (!locked) onPressedChange(!pressed);
        }}
      >
        <Lock aria-hidden className="size-3.5" />
        {t("documents.home.create.restricted_toggle")}
      </button>
      <span id={hintId} className={cn("text-caption text-muted-foreground", locked ? undefined : "sr-only")}>
        {locked ? t("documents.home.create.restricted_inherited") : t("documents.home.create.restricted_toggle_hint")}
      </span>
    </div>
  );
}

/** The same switch as the first entry of the "New" menu: a `menuitemcheckbox`, so the menu stays open. */
export function RestrictedMenuItem({ pressed, onPressedChange, locked = false }: Omit<RestrictedToggleProps, "className">) {
  const { t } = useTranslation();
  const hintId = useId();
  const on = pressed || locked;
  return (
    <DropdownMenuCheckboxItem
      checked={on}
      closeOnClick={false}
      aria-disabled={locked || undefined}
      aria-describedby={hintId}
      className="items-start gap-2 px-2 py-2 pointer-coarse:min-h-11"
      onCheckedChange={(next) => {
        if (!locked) onPressedChange(next);
      }}
    >
      <Lock aria-hidden className="mt-0.5 size-4" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{t("documents.home.create.restricted_toggle")}</span>
        <span id={hintId} className="text-caption text-muted-foreground">
          {locked ? t("documents.home.create.restricted_inherited") : t("documents.home.create.restricted_toggle_hint")}
        </span>
      </span>
    </DropdownMenuCheckboxItem>
  );
}
