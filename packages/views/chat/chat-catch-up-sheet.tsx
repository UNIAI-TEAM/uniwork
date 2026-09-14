"use client";

import { CheckCircle2, History, ListChecks, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatCatchUpResponse } from "@uniwork/core/types";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

function isEmptyBrief(result: ChatCatchUpResponse): boolean {
  return (
    result.message_count === 0 &&
    result.highlights.length === 0 &&
    result.action_items.length === 0
  );
}

export function ChatCatchUpSheet({
  open,
  onOpenChange,
  loading,
  error,
  result,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  result: ChatCatchUpResponse | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const empty = Boolean(result && !error && !loading && isEmptyBrief(result));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-title">
            <History aria-hidden className="size-4 text-muted-foreground" />
            {t("chat.ai.catch_up_title")}
          </SheetTitle>
          <SheetDescription>
            {result?.mode === "recent"
              ? t("chat.ai.catch_up_description_recent")
              : t("chat.ai.catch_up_description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {loading ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
              role="status"
            >
              <Spinner className="size-5" />
              <p className="text-body text-muted-foreground">{t("chat.ai.catch_up_loading")}</p>
            </div>
          ) : null}

          {!loading && error ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
              role="alert"
            >
              <IconTile icon={RotateCcw} size="lg" tone="destructive" />
              <div className="flex max-w-[36ch] flex-col gap-1">
                <p className="text-body font-medium text-foreground">{t("chat.ai.catch_up_failed")}</p>
                <p className="text-caption text-muted-foreground">{error}</p>
              </div>
              {onRetry ? (
                <Button type="button" variant="outline" onClick={onRetry}>
                  {t("common.retry")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {!loading && !error && empty ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
              role="status"
            >
              <IconTile icon={CheckCircle2} size="lg" tone="teal" />
              <div className="flex max-w-[36ch] flex-col gap-1">
                <p className="text-body font-medium text-foreground">{t("chat.ai.catch_up_empty_title")}</p>
                <p className="text-caption text-muted-foreground">{t("chat.ai.catch_up_empty")}</p>
              </div>
            </div>
          ) : null}

          {!loading && !error && result && !empty ? (
            <div className="flex flex-col gap-5">
              <section className="rounded-lg border border-border bg-muted/40 px-3 py-3">
                <p className="whitespace-pre-wrap text-body leading-6 text-foreground">{result.summary}</p>
                {result.message_count > 0 ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    {t("chat.ai.message_count", { count: result.message_count })}
                  </p>
                ) : null}
              </section>

              {result.highlights.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <p className="text-caption font-medium text-muted-foreground">{t("chat.ai.highlights")}</p>
                  <ul className="space-y-2">
                    {result.highlights.map((h) => (
                      <li
                        key={h}
                        className="flex gap-2 rounded-md border border-border bg-surface px-3 py-2 text-body text-foreground"
                      >
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                        <span className="min-w-0">{h}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {result.action_items.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                    <ListChecks aria-hidden className="size-3.5" />
                    {t("chat.ai.action_items")}
                  </p>
                  <ul className="space-y-2">
                    {result.action_items.map((item) => (
                      <li
                        key={`${item.title}-${item.source_message_id}`}
                        className="rounded-md border border-border bg-surface px-3 py-2.5"
                      >
                        <p className="text-body font-medium text-foreground">{item.title}</p>
                        {item.owner || item.due ? (
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            {[item.owner, item.due].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="text-caption text-muted-foreground">{t("chat.ai.action_items_hint")}</p>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
