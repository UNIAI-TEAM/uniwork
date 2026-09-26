"use client";

import { Inbox, Paperclip, Sparkles, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { tintClass } from "@uniwork/ui/components/common/icon-tile";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { identityTint } from "../people/identity-tint";
import { EmailHubListAiSummary } from "./email-hub-ai-insight";
import { emailHubLocale, formatEmailFullDate, formatEmailListDate, senderDisplayName } from "./email-hub-format";
import { EmailSenderAvatar } from "./email-hub-view-parts";

interface EmailHubThreadListItemProps {
  row: EmailHubThread;
  listFolder?: string;
  checked: boolean;
  selectionMode: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
  onPrefetch: () => void;
  onToggleStar: () => void;
  aiEnabled?: boolean;
  analyzing?: boolean;
  listSummary?: string;
  onAnalyze?: () => void;
  onNotSpam?: () => void;
}

const hoverActionClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-muted hover:text-foreground disabled:opacity-50 pointer-coarse:size-11";

/**
 * One conversation in the list. The list is a container: below ~48rem a row
 * stacks sender / subject / snippet, above it the row is a single scannable
 * line (sender, subject — snippet, labels, date) like every mail client. The
 * old fixed 18rem column truncated senders to three letters.
 */
export function EmailHubThreadListItem({
  row,
  listFolder = "INBOX",
  checked,
  selectionMode,
  onCheckedChange,
  onSelect,
  onPrefetch,
  onToggleStar,
  aiEnabled = false,
  analyzing = false,
  listSummary,
  onAnalyze,
  onNotSpam,
}: EmailHubThreadListItemProps) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const outgoing = row.folder === "SENT" || row.folder === "DRAFTS";
  const displayName = outgoing
    ? t("email_hub.to_recipient", { name: row.to_addrs[0] ?? row.from_addr })
    : senderDisplayName(row.from_name, row.from_addr);
  const subject = row.subject || t("email_hub.no_subject");
  const convCount = row.conversation_message_count ?? 0;
  const snippet = row.snippet?.trim();
  const showSnippet = Boolean(snippet && snippet !== subject);
  const unread = !row.is_read;
  const labels = row.imap_labels?.slice(0, 2) ?? [];
  const spamAction = listFolder === "SPAM" && !!onNotSpam;
  const aiAction = aiEnabled && !!onAnalyze;
  const hasActions = spamAction || aiAction;

  return (
    <li
      className={cn(
        "group/row relative border-b border-border/70 transition-colors duration-(--duration-fast)",
        checked ? "bg-brand-subtle/60" : "hover:bg-muted/60 focus-within:bg-muted/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2 px-3 py-2.5 @3xl:items-center @3xl:py-2 lg:px-4">
        <div className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center @3xl:mt-0">
          <EmailSenderAvatar
            fromName={outgoing ? undefined : row.from_name}
            fromAddr={outgoing ? row.to_addrs[0] : row.from_addr}
            className={cn(
              "size-9 text-caption transition-opacity duration-(--duration-fast)",
              (selectionMode || checked) && "opacity-0",
              "group-hover/row:opacity-0 group-has-[[data-slot=checkbox]:focus-visible]/row:opacity-0",
            )}
          />
          {/*
            Touch has no hover, so the checkbox sits on the avatar's corner and
            its 44px hit area covers the avatar: tapping the sender selects the
            row, the way mail apps on phones do.
          */}
          <Checkbox
            className={cn(
              "absolute opacity-0 transition-[opacity,translate] duration-(--duration-fast) group-hover/row:opacity-100 focus-visible:opacity-100",
              "pointer-coarse:translate-x-3 pointer-coarse:translate-y-3 pointer-coarse:bg-background pointer-coarse:opacity-100 pointer-coarse:after:-inset-3.5",
              (selectionMode || checked) && "opacity-100 pointer-coarse:translate-x-0 pointer-coarse:translate-y-0",
            )}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
            aria-label={t("email_hub.select_thread", { subject })}
          />
        </div>

        <button
          type="button"
          className={cn(
            hoverActionClass,
            "mt-0.5 @3xl:mt-0",
            row.is_starred ? "text-warning hover:text-warning" : "text-muted-foreground/70",
          )}
          aria-label={row.is_starred ? t("email_hub.unstar") : t("email_hub.star")}
          aria-pressed={row.is_starred}
          onClick={onToggleStar}
        >
          <Star className={cn("size-4", row.is_starred && "fill-current")} aria-hidden />
        </button>

        <div
          role="button"
          tabIndex={0}
          data-thread-row={row.id}
          aria-label={[
            unread ? t("email_hub.filters.unread") : null,
            displayName,
            subject,
            formatEmailFullDate(row.sent_at, locale),
            row.has_attachments ? t("email_hub.has_attachments") : null,
          ]
            .filter(Boolean)
            .join(", ")}
          className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-control @3xl:flex-row @3xl:items-center @3xl:gap-3"
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
          <div className="flex min-w-0 items-center gap-2 @3xl:w-52 @3xl:shrink-0">
            {unread ? <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden /> : null}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-body",
                unread ? "font-semibold text-foreground" : "text-foreground/80",
              )}
            >
              {displayName}
            </span>
            <time
              dateTime={row.sent_at}
              title={formatEmailFullDate(row.sent_at, locale)}
              className={cn(
                "shrink-0 text-caption tabular-nums @3xl:hidden",
                unread ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {formatEmailListDate(row.sent_at, locale)}
            </time>
          </div>

          <p className="min-w-0 flex-1 truncate text-body">
            <span className={cn(unread ? "font-semibold text-foreground" : "text-foreground/90")}>{subject}</span>
            {convCount > 1 ? (
              <span
                className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-caption font-medium tabular-nums text-muted-foreground"
                title={t("email_hub.conversation_count", { count: convCount })}
              >
                {convCount}
              </span>
            ) : null}
            {showSnippet ? (
              <>
                <span className="hidden text-muted-foreground @3xl:inline"> — </span>
                <span className="hidden text-muted-foreground @3xl:inline">{snippet}</span>
              </>
            ) : null}
          </p>
          {showSnippet ? <p className="truncate text-caption text-muted-foreground @3xl:hidden">{snippet}</p> : null}

          {listFolder === "SNOOZED" && row.snoozed_until ? (
            <p className="text-caption text-muted-foreground @3xl:shrink-0">
              {t("email_hub.snooze.until", { when: formatEmailListDate(row.snoozed_until, locale) })}
            </p>
          ) : null}

          {labels.length > 0 || row.has_attachments ? (
            <div className="mt-1 flex min-w-0 items-center gap-1 @3xl:mt-0 @3xl:shrink-0">
              {row.has_attachments ? (
                <span className="inline-flex text-muted-foreground" title={t("email_hub.has_attachments")}>
                  <Paperclip className="size-3.5" aria-hidden />
                  <span className="sr-only">{t("email_hub.has_attachments")}</span>
                </span>
              ) : null}
              {labels.map((label) => (
                <span
                  key={label}
                  className={cn(
                    "max-w-[8rem] truncate rounded-md px-1.5 py-0.5 text-caption",
                    tintClass[identityTint(label.toLowerCase())],
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}

          <time
            dateTime={row.sent_at}
            title={formatEmailFullDate(row.sent_at, locale)}
            className={cn(
              "hidden w-20 shrink-0 text-right text-caption tabular-nums @3xl:block",
              hasActions && "@3xl:group-hover/row:invisible @3xl:group-focus-within/row:invisible",
              unread ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {formatEmailListDate(row.sent_at, locale)}
          </time>
        </div>

        {hasActions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5",
              "@3xl:absolute @3xl:top-1/2 @3xl:right-3 @3xl:-translate-y-1/2 lg:@3xl:right-4",
              analyzing
                ? "@3xl:flex"
                : cn(
                    "md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 @3xl:hidden @3xl:group-hover/row:flex @3xl:group-focus-within/row:flex",
                    !spamAction && "max-md:hidden",
                  ),
            )}
          >
            {spamAction ? (
              <button type="button" className={hoverActionClass} aria-label={t("email_hub.not_spam")} onClick={onNotSpam}>
                <Inbox className="size-4" aria-hidden />
              </button>
            ) : null}
            {aiAction ? (
              <button
                type="button"
                className={cn(hoverActionClass, analyzing && "bg-brand-subtle text-brand-subtle-foreground")}
                aria-label={t("email_hub.ai.summarize_in_list", { subject })}
                aria-busy={analyzing}
                disabled={analyzing}
                onClick={onAnalyze}
              >
                {analyzing ? <Spinner className="size-4" /> : <Sparkles className="size-4" aria-hidden />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <EmailHubListAiSummary analyzing={analyzing} listSummary={listSummary} />
    </li>
  );
}
