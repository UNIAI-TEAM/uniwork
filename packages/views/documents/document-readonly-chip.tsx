"use client";

import { Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readonlyKeys } from "./document-readonly-copy";

/** The page header's read-only level chip, shown below sm where the notice strip is hidden. */
export function DocumentReadonlyChip({ canComment }: { canComment: boolean }) {
  const { t } = useTranslation();
  const keys = readonlyKeys(canComment);
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground sm:hidden"
      title={t(keys.description)}>
      <Eye aria-hidden className="size-3.5" />
      {t(keys.badge)}
    </span>
  );
}
