"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HomeSource } from "@uniwork/core/types/home";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/** One source of the home screen failed; the section says which and offers a retry. */
export function HomePartialNotice({
  source,
  onRetry,
  retrying,
}: {
  source: HomeSource;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-caption text-muted-foreground">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">{t(`home.partial.${source}`)}</span>
      <Button type="button" variant="outline" size="xs" onClick={onRetry} disabled={retrying}>
        <RefreshCw aria-hidden className={cn(retrying && "motion-safe:animate-spin")} />
        {t("home.partial.retry")}
      </Button>
    </div>
  );
}
