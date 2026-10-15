"use client";

import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";

/** A restricted document's marker in lists: lock icon plus the word, never colour alone (DOC-02). */
export function RestrictedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn("shrink-0", className)}>
      <Lock aria-hidden />
      {t("documents.library.restricted_badge")}
    </Badge>
  );
}
