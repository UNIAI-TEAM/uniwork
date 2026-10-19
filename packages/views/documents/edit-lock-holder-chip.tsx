"use client";

import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initials } from "../people/actor-chip";
import { formatLockTime } from "./edit-lock-copy";

/**
 * Who is editing a document (UNI-1645, addendum §11.4): a small avatar and
 * "editing", named in full for the tooltip and screen readers. Library rows
 * and the document header use it; below `sm` the avatar stands alone.
 */
export function EditLockHolderChip({
  name,
  avatarUrl,
  offlineHoldUntil,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  offlineHoldUntil?: string | null;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const displayName = name || t("documents.editLock.lostSomeone");
  const offlineTime = offlineHoldUntil ? formatLockTime(offlineHoldUntil, i18n.language) : "";
  const label = offlineTime
    ? t("documents.editLock.bannerOfflineHold", { name: displayName, time: offlineTime })
    : t("documents.editLock.rowEditingLabel", { name: displayName });
  const stateText = offlineTime
    ? t("documents.editLock.rowEditingOffline", { time: offlineTime })
    : t("documents.editLock.rowEditing");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="edit-lock-holder"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft py-0.5 pr-2 pl-1 text-caption text-info-soft-foreground", className)}
    >
      <ActorAvatar name={name || "?"} initials={initials(name || "?")} avatarUrl={avatarUrl} size="xs" />
      <span aria-hidden className="hidden whitespace-nowrap sm:inline">{stateText}</span>
    </span>
  );
}
