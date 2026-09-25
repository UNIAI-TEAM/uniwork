"use client";

import type { KeyboardEvent } from "react";
import { Archive, Mail, MailOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Notification } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { UI_EASE_OUT, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { NotificationMark } from "./notification-mark";
import { NotificationTitle } from "./notification-title";
import { relativeTime } from "./relative-time";
import { useNow } from "./use-now";

export interface NotificationRowProps {
  notification: Notification;
  href: string;
  onOpen: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
  onArchive: (n: Notification) => void;
  /** Compact rows for the bell popover and Home: no row actions. */
  compact?: boolean;
  /** The inbox's mail keys (j/k/r/e), attached to the row's link. */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  /** Off where every row is unread (Home), so the bar would tell nothing apart. */
  unreadBar?: boolean;
}

/**
 * The element j/k land on: the row's link. A row whose resource is gone has
 * no link and is skipped by the keys; its actions stay reachable with Tab.
 * The inbox queries this to move focus, so the keys and Tab agree on what
 * the current row is.
 */
export const ROW_FOCUS_SELECTOR = "[data-row-focus]";

function absoluteTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(d);
}

/**
 * One inbox line, read left to right the way a person triages: who (the
 * actor's face, the kind pinned to its corner in the module's tint), what
 * (the locale's sentence with the actor, the thing and the state picked
 * out, up to two lines so the task name is never cut to "Rà soát hợ…"), and
 * when. Unread rows carry a brand bar on the leading edge and full-strength
 * type; read rows step back to muted. A deleted resource is still a row (the
 * person was told something) but is dimmed and not a link.
 *
 * The actions float over the row's trailing edge on the row's own fill
 * instead of pushing the text aside, so hovering never reflows the list.
 * Under a finger there is no hover: they stay, and the row keeps room.
 *
 * Plain list semantics on purpose: the link and the two actions are real
 * focusable elements in the tab order. A listbox would hide them from
 * assistive tech (option children are presentational) and from Tab.
 */
export function NotificationRow({
  notification: n,
  href,
  onOpen,
  onToggleRead,
  onArchive,
  compact,
  onKeyDown,
  unreadBar = true,
}: NotificationRowProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const reduceMotion = useReducedMotion() ?? false;
  const unread = !n.read_at;
  const merged = n.count > 1 ? t("notifications.merged_other", { count: n.count - 1 }) : "";

  const body = (
    <>
      <NotificationMark notification={n} dimmed={!unread} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("line-clamp-2 text-body text-pretty", unread ? "text-foreground" : "text-muted-foreground")}>
          {unread ? <span className="sr-only">{`${t("notifications.unread_dot")}: `}</span> : null}
          <NotificationTitle notification={n} unread={unread} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          <time
            dateTime={n.created_at}
            title={absoluteTime(n.created_at, i18n.language)}
            className={cn("tabular-nums", unread && "font-medium text-brand-subtle-foreground")}
          >
            {relativeTime(n.created_at, i18n.language, now)}
          </time>
          {merged ? <span aria-hidden>·</span> : null}
          {merged ? <span>{merged}</span> : null}
          {n.resource_deleted ? <span aria-hidden>·</span> : null}
          {n.resource_deleted ? <span className="italic">{t("notifications.deleted")}</span> : null}
        </span>
      </span>
    </>
  );

  // No `block` on the link below: tailwind-merge treats it as a display
  // conflict with this `flex` and the mark stacked above the title.
  // Focus is drawn inset: the list scrolls, and an offset outline would be
  // clipped at the top and bottom edges of the viewport.
  const rowClass = cn(
    "relative flex items-start gap-3 rounded-lg px-3 py-2.5 text-left",
    "transition-colors duration-(--duration-fast) ease-out-quart motion-reduce:transition-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    "group-hover:bg-surface-hover group-focus-within:bg-surface-selected",
    // Under a finger the actions never hide, so the text never runs under them.
    !compact && "pointer-coarse:pr-26",
    // The unread bar: 3px of brand on the leading edge, inside the row so
    // it scrolls with it and follows the row's rounded corners.
    unread && unreadBar && "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
    n.resource_deleted && "opacity-60",
  );

  return (
    <motion.li
      data-notification-id={n.id}
      // Archiving folds the row away instead of snapping the list up; with
      // reduced motion it only fades. Outside an AnimatePresence (the bell,
      // Home) there is no exit and this is a plain `li`.
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: UI_MOTION_DURATION.fast } }
          : { opacity: 0, height: 0, transition: { duration: UI_MOTION_DURATION.standard, ease: UI_EASE_OUT } }
      }
      // `group` lives here, not on the link: the actions are the link's
      // sibling, and a group on the link would never reveal them. The row
      // publishes its fill as --row-fill so the avatar badge's cut-out ring
      // and the floating actions match it.
      className={cn(
        "group relative overflow-hidden rounded-lg",
        "hover:[--row-fill:var(--surface-hover)] focus-within:[--row-fill:var(--surface-selected)]",
      )}
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
        <div
          className={cn(
            "absolute top-1.5 right-1.5 hidden items-center gap-0.5 rounded-md bg-[var(--row-fill,var(--background))] pl-1",
            "group-hover:flex group-focus-within:flex pointer-coarse:top-1/2 pointer-coarse:flex pointer-coarse:-translate-y-1/2",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
            aria-label={unread ? t("notifications.mark_read") : t("notifications.mark_unread")}
            title={unread ? t("notifications.mark_read") : t("notifications.mark_unread")}
            onClick={() => onToggleRead(n)}
          >
            {unread ? <MailOpen aria-hidden className="size-4" /> : <Mail aria-hidden className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
            aria-label={t("notifications.archive")}
            title={t("notifications.archive")}
            onClick={() => onArchive(n)}
          >
            <Archive aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </motion.li>
  );
}
