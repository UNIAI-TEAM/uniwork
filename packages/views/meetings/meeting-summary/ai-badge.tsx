"use client";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";

/** The one mark every AI output in meetings carries (PRODUCT.md › Agent Principles). */
export function AiBadge() {
  const { t } = useTranslation();
  return (
    <Badge className="gap-1 bg-brand-subtle text-brand-subtle-foreground">
      <Sparkles aria-hidden />
      {t("meetings.aiLabel")}
    </Badge>
  );
}
