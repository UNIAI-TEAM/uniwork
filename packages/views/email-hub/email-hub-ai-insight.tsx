"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ListChecks, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

const LIST_SUMMARY_PREVIEW_LEN = 220;

export function EmailHubAiInsightShell({
  children,
  className,
  loading,
  onPointerStop,
}: {
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  onPointerStop?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/70 bg-surface pl-3.5 shadow-sm",
        "before:pointer-events-none before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r-full before:bg-brand",
        loading && "border-dashed border-brand/30 bg-brand-subtle/25",
        className,
      )}
      {...(onPointerStop
        ? {
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
            onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
          }
        : {})}
    >
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

function EmailHubAiInsightHeader({
  loading,
  cardOpen,
  onToggleCard,
}: {
  loading?: boolean;
  cardOpen?: boolean;
  onToggleCard?: () => void;
}) {
  const { t } = useTranslation();
  const inner = (
    <>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
        {loading ? <Spinner className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-caption font-semibold text-foreground">{t("email_hub.ai.list_badge")}</p>
        <p className="text-caption text-muted-foreground">{t("email_hub.ai.list_attribution")}</p>
      </div>
      {onToggleCard ? (
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !cardOpen && "-rotate-90")}
          aria-hidden
        />
      ) : null}
    </>
  );

  if (onToggleCard) {
    const label = cardOpen ? t("email_hub.ai.list_hide_card") : t("email_hub.ai.list_show_card");
    return (
      <button
        type="button"
        className={cn(
          "flex w-full min-h-11 items-center gap-2 rounded-lg pr-1 transition-colors",
          cardOpen ? "mb-2" : "mb-0",
          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-expanded={cardOpen}
        aria-label={label}
        onClick={onToggleCard}
      >
        {inner}
      </button>
    );
  }

  return <div className="mb-2 flex items-center gap-2">{inner}</div>;
}

export function EmailHubListAiSummary({
  analyzing,
  listSummary,
}: {
  analyzing?: boolean;
  listSummary?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [listSummary]);

  if (!analyzing && !listSummary) return null;

  const long = Boolean(listSummary && listSummary.length > LIST_SUMMARY_PREVIEW_LEN);
  const preview =
    listSummary && !expanded && long
      ? `${listSummary.slice(0, LIST_SUMMARY_PREVIEW_LEN).trimEnd()}…`
      : listSummary;
  const body =
    analyzing && !listSummary ? t("email_hub.ai.analyzing") : preview ?? "";

  return (
    <div
      className={cn(
        "mt-1.5 flex gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5",
        analyzing && !listSummary && "border-dashed border-brand/25 bg-brand-subtle/20",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-brand" aria-hidden>
        {analyzing && !listSummary ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-caption leading-snug text-muted-foreground",
            expanded ? "whitespace-pre-wrap" : "line-clamp-2",
          )}
        >
          {body}
        </p>
        {long && listSummary ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 h-7 gap-1 rounded-md px-1.5 text-caption font-medium text-brand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("email_hub.ai.list_collapse") : t("email_hub.ai.list_expand")}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmailHubAiSummaryDetail({ summary }: { summary: EmailHubThreadSummary }) {
  const { t } = useTranslation();
  const actionCount = summary.action_items.length;
  const [cardOpen, setCardOpen] = useState(true);

  return (
    <EmailHubAiInsightShell className="mt-1">
      <EmailHubAiInsightHeader cardOpen={cardOpen} onToggleCard={() => setCardOpen((v) => !v)} />
      {cardOpen ? (
        <>
          <p className="text-body leading-relaxed text-foreground">{summary.summary}</p>
          {summary.key_points.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t border-border/80 pt-3">
              {summary.key_points.map((point) => (
                <li key={point} className="flex gap-2 text-body leading-snug text-muted-foreground">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.needs_reply && summary.reply_hint ? (
            <p className="mt-3 rounded-lg border border-border bg-muted/35 px-3 py-2.5 text-body leading-snug text-muted-foreground">
              {summary.reply_hint}
            </p>
          ) : null}
          {actionCount > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <ListChecks className="size-3.5 shrink-0 text-brand" aria-hidden />
              {t("email_hub.ai.action_items_count", { count: actionCount })}
            </p>
          ) : null}
        </>
      ) : null}
    </EmailHubAiInsightShell>
  );
}
