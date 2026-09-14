"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CheckCheck, Inbox, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import {
  useArchive,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
  useNotifications,
  useUnreadCount,
} from "@uniwork/core/notifications";
import type { Notification } from "@uniwork/core/types";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { NotificationRow, ROW_FOCUS_SELECTOR } from "./notification-row";
import { resourceHref } from "./resource-href";

type Filter = "all" | "unread";

/** The mail keys, shown under the list on wide screens. */
const KEY_HINTS: [string[], string][] = [
  [["j", "k"], "notifications.keys_move"],
  [["r"], "notifications.keys_read"],
  [["e"], "notifications.keys_archive"],
];

/**
 * The inbox: this workspace's notifications, unread first, then everything
 * earlier. Opening a row marks it read; nothing is marked by merely looking.
 * j/k move, Enter opens, r toggles read, e archives — the same keys as mail.
 *
 * "Current" is simply the row that holds focus. The keys move real focus
 * between the rows' links, so Tab, the mouse and j/k never disagree, and
 * the row actions stay in the tab order instead of behind a listbox.
 */
export function InboxView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLUListElement>(null);

  // ponytail: one page of 50; add cursor paging (next_before) when a real
  // inbox outgrows it.
  const list = useNotifications({ workspaceId: workspace.id, unreadOnly: filter === "unread", limit: 50 });
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const archive = useArchive();
  const markAll = useMarkAllRead();

  const rows = useMemo(() => list.data?.notifications ?? [], [list.data]);
  const groups = useMemo(
    () => ({ unread: rows.filter((n) => !n.read_at), earlier: rows.filter((n) => !!n.read_at) }),
    [rows],
  );
  const ordered = useMemo(() => [...groups.unread, ...groups.earlier], [groups]);
  const unreadHere = unread.data?.by_workspace[workspace.id] ?? 0;

  const fail = () => toast.error(t("notifications.error"));
  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate([n.id], { onError: fail });
  };
  const toggleRead = (n: Notification) => {
    (n.read_at ? markUnread : markRead).mutate([n.id], { onError: fail });
  };
  const doArchive = (n: Notification) => archive.mutate([n.id], { onError: fail });

  // Moves focus to the nearest row with a link from `from` in `dir`; rows
  // whose resource is gone have none and are stepped over.
  const focusRow = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < ordered.length; i += dir) {
      const n = ordered[i];
      if (!n || n.resource_deleted) continue;
      const el = listRef.current?.querySelector<HTMLElement>(`[data-notification-id="${n.id}"] ${ROW_FOCUS_SELECTOR}`);
      if (!el) continue;
      el.focus();
      el.scrollIntoView?.({ block: "nearest" });
      return;
    }
  };

  // Attached to each row's link, so it only ever fires on the row that holds
  // focus. Enter is left to the link itself.
  const onRowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const id = e.currentTarget.closest<HTMLElement>("[data-notification-id]")?.dataset.notificationId;
    const idx = ordered.findIndex((n) => n.id === id);
    const current = ordered[idx];
    if (!current) return;
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        focusRow(idx, 1);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        focusRow(idx, -1);
        break;
      case "r":
        e.preventDefault();
        toggleRead(current);
        break;
      case "e":
        e.preventDefault();
        doArchive(current);
        // The next row inherits focus; the last row hands it back up.
        if (idx + 1 < ordered.length) focusRow(idx, 1);
        else focusRow(idx, -1);
        break;
      default:
        break;
    }
  };

  const settingsHref = `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=notifications`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Inbox}
        tone={moduleTone("inbox")}
        title={t("nav.inbox")}
        count={unreadHere}
        actions={
          <>
            <ToggleGroup
              value={[filter]}
              onValueChange={(v) => {
                const next = v[0] as Filter | undefined;
                if (next) setFilter(next);
              }}
              aria-label={t("notifications.filter")}
              variant="toolbar"
              size="sm"
            >
              <ToggleGroupItem value="all" className="pointer-coarse:h-11">
                {t("notifications.filter_all")}
              </ToggleGroupItem>
              <ToggleGroupItem value="unread" className="pointer-coarse:h-11">
                {t("notifications.filter_unread")}
              </ToggleGroupItem>
            </ToggleGroup>
            <CollectionPageHeaderAction
              icon={CheckCheck}
              label={t("notifications.mark_all_read")}
              disabled={unreadHere === 0 || markAll.isPending}
              onClick={() => markAll.mutate(workspace.id, { onError: fail })}
            />
          </>
        }
      />
      {list.isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : list.isError ? (
        <CollectionPageState
          icon={Inbox}
          tone="destructive"
          role="alert"
          title={t("notifications.error_title")}
          description={t("notifications.error")}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : ordered.length === 0 ? (
        <CollectionPageState
          icon={Inbox}
          tone={moduleTone("inbox")}
          role="status"
          title={filter === "unread" ? t("notifications.empty_unread_title") : t("notifications.empty_title")}
          description={t("notifications.empty_description")}
          actions={
            <AppLink href={settingsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Settings aria-hidden className="size-4" />
              {t("notifications.empty_settings")}
            </AppLink>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul ref={listRef} aria-label={t("nav.inbox")}>
            {groups.unread.length > 0 ? <GroupLabel>{t("notifications.group_unread")}</GroupLabel> : null}
            {groups.unread.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                onOpen={open}
                onToggleRead={toggleRead}
                onArchive={doArchive}
                onKeyDown={onRowKeyDown}
              />
            ))}
            {groups.earlier.length > 0 ? <GroupLabel>{t("notifications.group_earlier")}</GroupLabel> : null}
            {groups.earlier.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                onOpen={open}
                onToggleRead={toggleRead}
                onArchive={doArchive}
                onKeyDown={onRowKeyDown}
              />
            ))}
          </ul>
          <p className="hidden items-center gap-2 px-3 py-3 text-caption text-muted-foreground md:flex">
            {KEY_HINTS.map(([keys, label]) => (
              <span key={label} className="flex items-center gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
                <span>{t(label)}</span>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <li role="presentation" className="sticky top-0 z-10 bg-background/95 px-3 pt-3 pb-1 text-overline text-muted-foreground backdrop-blur">
      {children}
    </li>
  );
}
