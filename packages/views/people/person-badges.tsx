"use client";

import { Ban, Crown, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { SettingsBadge } from "../settings/components/settings-layout";

/**
 * The standing chips of the directory, on the same soft signal pairs the
 * member list in Settings uses, so a role reads the same wherever a person is
 * shown. "Member" is the default and gets no chip: a column of identical
 * "Thành viên" pills is noise that hides the two roles that matter.
 */
export function RoleBadge({ role, showMember = false }: { role: string; showMember?: boolean }) {
  const { t } = useTranslation();
  const label = t(`people.role_${role}`, { defaultValue: role });
  switch (role) {
    case "owner":
      return (
        <SettingsBadge tone="brand" icon={<Crown aria-hidden="true" />}>
          {label}
        </SettingsBadge>
      );
    case "admin":
      return (
        <SettingsBadge tone="info" icon={<ShieldCheck aria-hidden="true" />}>
          {label}
        </SettingsBadge>
      );
    default:
      return showMember ? <span className="text-caption text-muted-foreground">{label}</span> : null;
  }
}

/** Deactivation changes what every other fact on the row means, so it is a chip, never a colour alone. */
export function DeactivatedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <SettingsBadge tone="muted" icon={<Ban aria-hidden="true" />} className={className}>
      {t("people.status_deactivated")}
    </SettingsBadge>
  );
}

/** "Bạn" beside the reader's own entry, so they can find themselves and tell their card from a namesake's. */
export function SelfTag({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center rounded-sm bg-brand-subtle px-1 text-micro font-semibold text-brand-subtle-foreground",
        className,
      )}
    >
      {t("people.you")}
    </span>
  );
}
