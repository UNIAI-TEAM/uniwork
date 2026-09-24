"use client";

import { Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { EmailHubAiPanel } from "./email-hub-ai-panel";

interface EmailHubAiRailProps {
  /** Column (from `xl`) or sheet — the caller owns the query so its toggle knows which one it opens. */
  wide: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  accountId: string;
  threadId: string;
  bodyReady: boolean;
  initialSummary?: EmailHubThreadSummary;
  onSummaryChange?: (summary: EmailHubThreadSummary) => void;
}

export const EMAIL_HUB_AI_WIDE_QUERY = "(min-width: 80rem)";

/**
 * The AI assistant for the open email. A column from `xl`, a sheet below it —
 * it used to be hidden entirely under `lg`, so tablets and phones had no
 * summary and no Ask UNI. Only one of the two is mounted: the panel runs a
 * summary query, and a CSS-hidden copy would run it twice.
 *
 * It exists only while an email is open. With nothing open it used to show
 * three counts that repeated the list header, pinned above the mailbox list.
 */
export function EmailHubAiRail({ wide, open, onOpenChange, ...panel }: EmailHubAiRailProps) {
  const { t } = useTranslation();

  if (wide) {
    if (!open) return null;
    return (
      <aside
        className="flex h-full min-h-0 w-80 shrink-0 flex-col border-l border-border bg-sidebar"
        aria-labelledby="email-hub-ai-rail-title"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border py-2 pr-2 pl-4">
          <Sparkles className="size-4 text-brand" aria-hidden />
          <h2 id="email-hub-ai-rail-title" className="flex-1 text-body font-semibold">
            {t("email_hub.ai_title")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("email_hub.ai_close")}
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EmailHubAiPanel {...panel} />
        </div>
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" closeLabel={t("common.close")}>
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" aria-hidden />
            {t("email_hub.ai_title")}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("email_hub.ai_description")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EmailHubAiPanel {...panel} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
