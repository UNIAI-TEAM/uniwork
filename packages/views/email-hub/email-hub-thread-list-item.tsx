"use client";

import { Inbox, Paperclip, Sparkles, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { EmailHubListAiSummary } from "./email-hub-ai-insight";
import { EmailSenderAvatar, formatWhen } from "./email-hub-view-parts";
import { emailHubIconActionClass } from "./email-hub-ui";

interface EmailHubThreadListItemProps {
  row: EmailHubThread;
  listFolder?: string;
  selected: boolean;
  onSelect: () => void;
  onPrefetch: () => void;
  onToggleStar: () => void;
  aiEnabled?: boolean;
  analyzing?: boolean;
  listSummary?: string;
  onAnalyze?: () => void;
  onNotSpam?: () => void;
}

export function EmailHubThreadListItem({
  row,
  listFolder = "INBOX",
  selected,
  onSelect,
  onPrefetch,
  onToggleStar,
  aiEnabled = false,
  analyzing = false,
  listSummary,
  onAnalyze,
  onNotSpam,
}: EmailHubThreadListItemProps) {
  const { t } = useTranslation();
  const displayName =
    row.folder === "SENT" || row.folder === "DRAFTS"
      ? (row.to_addrs[0] ?? row.from_addr)
      : (row.from_name || row.from_addr);
  const subject = row.subject || t("email_hub.no_subject");
  const snippet = row.snippet?.trim();
  const showAiInsight = Boolean(analyzing || listSummary);
  const showSnippet = Boolean(snippet && snippet !== subject && !showAiInsight);

  return (
    <li
      className={cn(
        "group mx-2 rounded-xl border transition-colors",
        selected
          ? "border-brand/30 bg-surface-selected shadow-sm"
          : "border-transparent hover:border-border/80 hover:bg-muted/25",
      )}
    >
      <div className="flex min-w-0 items-start gap-0.5 px-1.5 py-2 sm:px-2">
        <button
          type="button"
          className={cn(
            emailHubIconActionClass,
            "mt-0.5 size-9 shrink-0 rounded-lg",
            row.is_starred && "text-brand hover:text-brand",
          )}
          aria-label={row.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
          aria-pressed={row.is_starred}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
        >
          <Star
            className={cn("size-4", row.is_starred ? "fill-brand text-brand" : "text-muted-foreground/65")}
            aria-hidden
          />
        </button>

        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 cursor-pointer gap-2.5 py-0.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
          onClick={onSelect}
          onMouseEnter={onPrefetch}
          onFocus={onPrefetch}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect();
            }
          }}
        >
          <div className="relative shrink-0">
            <EmailSenderAvatar fromName={row.from_name} fromAddr={row.from_addr} className="size-8 text-caption" />
            {!row.is_read ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-brand"
                aria-hidden
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            {!row.is_read ? <span className="sr-only">{t("email_hub.filters.unread")}</span> : null}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-body leading-tight",
                  !row.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                )}
              >
                {displayName}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                {row.has_attachments ? (
                  <span
                    className="inline-flex size-7 items-center justify-center text-muted-foreground"
                    title={t("email_hub.has_attachments")}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    <span className="sr-only">{t("email_hub.has_attachments")}</span>
                  </span>
                ) : null}
                {listFolder === "SPAM" && onNotSpam ? (
                  <button
                    type="button"
                    className={cn(
                      emailHubIconActionClass,
                      "size-8 rounded-lg text-brand opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                    )}
                    aria-label={t("email_hub.not_spam")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotSpam();
                    }}
                  >
                    <Inbox className="size-3.5" aria-hidden />
                  </button>
                ) : null}
                {aiEnabled && onAnalyze ? (
                  <button
                    type="button"
                    className={cn(
                      emailHubIconActionClass,
                      "size-8 rounded-lg",
                      analyzing && "bg-brand-subtle text-brand",
                      !analyzing &&
                        "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                    )}
                    aria-label={t("email_hub.ai.summarize")}
                    aria-busy={analyzing}
                    disabled={analyzing}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyze();
                    }}
                  >
                    {analyzing ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" aria-hidden />}
                  </button>
                ) : null}
                <time
                  dateTime={row.sent_at}
                  className="min-w-[4.25rem] pl-0.5 text-right text-caption tabular-nums leading-none text-muted-foreground"
                >
                  {formatWhen(row.sent_at)}
                </time>
              </div>
            </div>

            <p
              className={cn(
                "mt-0.5 truncate text-body leading-snug",
                !row.is_read ? "font-semibold text-foreground" : "text-foreground/95",
              )}
            >
              {subject}
            </p>

            {showSnippet ? (
              <p className="mt-0.5 truncate text-caption leading-snug text-muted-foreground">{snippet}</p>
            ) : null}

            {listFolder === "SNOOZED" && row.snoozed_until ? (
              <p className="mt-0.5 text-caption text-muted-foreground">
                {t("email_hub.snooze.until", { when: formatWhen(row.snoozed_until) })}
              </p>
            ) : null}

            {row.imap_labels && row.imap_labels.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {row.imap_labels.slice(0, 2).map((label) => (
                  <li
                    key={label}
                    className="max-w-[8rem] truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-caption text-muted-foreground"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            ) : null}

            <EmailHubListAiSummary analyzing={analyzing} listSummary={listSummary} />
          </div>
        </div>
      </div>
    </li>
  );
}
