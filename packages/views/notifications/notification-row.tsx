"use client";

import { Archive, Mail, MailOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Notification } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { KindIcon } from "./kind-icon";
import { relativeTime } from "./relative-time";

export interface NotificationRowProps {
  notification: Notification;
  href: string;
  selected?: boolean;
  onOpen: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
  onArchive: (n: Notification) => void;
  /** Compact rows for the bell popover: no hover actions. */
  compact?: boolean;
}

/**
 * One inbox line: kind glyph, the title rendered from title_key + params in
 * the current locale, "and N more changes" when events merged, relative
 * time, and the unread dot. A deleted resource is still a row (the person
 * was told something) but is dimmed and not a link.
 */
export function NotificationRow({ notification: n, href, selected, onOpen, onToggleRead, onArchive, compact }: NotificationRowProps) {
  const { t, i18n } = useTranslation();
  const unread = !n.read_at;
  const title = t(n.title_key, { ...n.params, defaultValue: n.kind });
  const merged = n.count > 1 ? t("notifications.merged_other", { count: n.count - 1 }) : "";

  const body = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
          unread && "bg-primary/10 text-primary",
        )}
      >
        <KindIcon kind={n.kind} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-body", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <time dateTime={n.created_at}>{relativeTime(n.created_at, i18n.language)}</time>
          {merged ? <span aria-hidden>·</span> : null}
          {merged ? <span>{merged}</span> : null}
          {n.resource_deleted ? <span aria-hidden>·</span> : null}
          {n.resource_deleted ? <span className="italic">{t("notifications.deleted")}</span> : null}
        </span>
      </span>
      {unread ? (
        <span aria-label={t("notifications.unread_dot")} role="img" className="size-2 shrink-0 rounded-full bg-primary" />
      ) : null}
    </>
  );

  const rowClass = cn(
    "group flex min-h-11 items-center gap-3 px-3 py-2 text-left outline-none",
    selected ? "bg-surface-selected" : "hover:bg-surface-hover",
    n.resource_deleted && "opacity-60",
  );

  return (
    <li
      id={n.id}
      role="option"
      data-notification-id={n.id}
      aria-selected={!!selected}
      className={cn("relative border-b border-border last:border-b-0", compact && "border-b-0")}
    >
      {n.resource_deleted ? (
        <div className={rowClass}>{body}</div>
      ) : (
        <AppLink
          href={href}
          className={cn(rowClass, "block")}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            onOpen(n);
          }}
        >
          {body}
        </AppLink>
      )}
      {compact ? null : (
        <div className="absolute inset-y-0 right-2 hidden items-center gap-1 group-hover:flex group-focus-within:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={unread ? t("notifications.mark_read") : t("notifications.mark_unread")}
            onClick={() => onToggleRead(n)}
          >
            {unread ? <MailOpen aria-hidden className="size-4" /> : <Mail aria-hidden className="size-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("notifications.archive")} onClick={() => onArchive(n)}>
            <Archive aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}
