"use client";

import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { initials } from "../people/actor-chip";

/**
 * Who is editing a document (UNI-1645, addendum §11.4): a small avatar and
 * "editing", named in full for the tooltip and screen readers. Library rows
 * and the document header use it; below `sm` the avatar stands alone.
 */
export function EditLockHolderChip({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t("documents.editLock.rowEditingLabel", { name: name || t("documents.editLock.lostSomeone") });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="edit-lock-holder"
      className={cn("inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground", className)}
    >
      <ActorAvatar name={name || "?"} initials={initials(name || "?")} avatarUrl={avatarUrl} size="xs" />
      <span aria-hidden className="hidden whitespace-nowrap sm:inline">{t("documents.editLock.rowEditing")}</span>
    </span>
  );
}
