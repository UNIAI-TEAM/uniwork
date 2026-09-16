"use client";

import type { KeyboardEvent } from "react";
import { Archive, Mail, MailOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Notification } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { relativeTime } from "./relative-time";
import { useNow } from "./use-now";

export interface NotificationRowProps {
  notification: Notification;
  href: string;
  onOpen: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
  onArchive: (n: Notification) => void;
  /** Compact rows for the bell popover: no row actions. */
  compact?: boolean;
  /** The inbox's mail keys (j/k/r/e), attached to the row's link. */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The element j/k land on: the row's link. A row whose resource is gone has
 * no link and is skipped by the keys; its actions stay reachable with Tab.
 * The inbox queries this to move focus, so the keys and Tab agree on what
 * the current row is.
 */
export const ROW_FOCUS_SELECTOR = "[data-row-focus]";

/**
 * One inbox line: the kind's mark (a circle in the module's tint — tasks
 * green, meetings violet — so the row says where it came from before the
 * title is read), the title rendered from title_key + params in the current
 * locale, "and N more changes" when events merged, relative time, and the
 * unread dot. Unread rows also carry a brand bar on the leading edge, the
 * same cue the reference layout uses, so a scan down the list finds them
 * without reading. A deleted resource is still a row (the person was told
 * something) but is dimmed and not a link.
 *
 * Plain list semantics on purpose: the link and the two actions are real
 * focusable elements in the tab order. A listbox would hide them from
 * assistive tech (option children are presentational) and from Tab.
 */
export function NotificationRow({ notification: n, href, onOpen, onToggleRead, onArchive, compact, onKeyDown }: NotificationRowProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const unread = !n.read_at;
  const title = t(n.title_key, { ...n.params, defaultValue: n.kind });
  const merged = n.count > 1 ? t("notifications.merged_other", { count: n.count - 1 }) : "";

  const body = (
    <>
      <IconTile
        icon={kindIcon(n.kind)}
        shape="circle"
        size="sm"
        tone={kindTone(n.kind)}
        className={cn("size-8 [&_svg]:size-4", !unread && "opacity-70")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-body", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <time dateTime={n.created_at}>{relativeTime(n.created_at, i18n.language, now)}</time>
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

  // No `block` on the link below: tailwind-merge treats it as a display
  // conflict with this `flex` and the mark stacked above the title.
  // Focus is drawn inset: the list scrolls, and an offset outline would be
  // clipped at the top and bottom edges of the viewport.
  const rowClass = cn(
    "relative flex min-h-11 items-center gap-3 px-3 py-2 text-left",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    "group-hover:bg-surface-hover group-focus-within:bg-surface-selected",
    // Room for the actions when they are showing: on hover, on focus, and
    // always on a coarse pointer where there is no hover to reveal them.
    !compact && "group-hover:pr-20 group-focus-within:pr-20 pointer-coarse:pr-24",
    // The unread bar: 2px of brand on the leading edge, inside the row so
    // it scrolls with it and never fights the list's own border.
    unread && "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary",
    n.resource_deleted && "opacity-60",
  );

  return (
    <li
      data-notification-id={n.id}
      // `group` lives here, not on the link: the actions are the link's
      // sibling, and a group on the link would never reveal them.
      className={cn("group relative border-b border-border last:border-b-0", compact && "border-b-0")}
    >
      {n.resource_deleted ? (
        <div className={rowClass}>{body}</div>
      ) : (
        <AppLink
          href={href}
          data-row-focus
          className={rowClass}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            onOpen(n);
          }}
        >
          {body}
        </AppLink>
      )}
      {compact ? null : (
        <div className="absolute inset-y-0 right-2 hidden items-center gap-1 group-hover:flex group-focus-within:flex pointer-coarse:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label={unread ? t("notifications.mark_read") : t("notifications.mark_unread")}
            onClick={() => onToggleRead(n)}
          >
            {unread ? <MailOpen aria-hidden className="size-4" /> : <Mail aria-hidden className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label={t("notifications.archive")}
            onClick={() => onArchive(n)}
          >
            <Archive aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}
