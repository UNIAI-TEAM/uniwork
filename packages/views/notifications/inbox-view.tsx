"use client";

import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { CheckCheck, Inbox, ListFilter, Settings } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import { useMarkRead, useMarkUnread, useNotificationPages, useUnreadCount } from "@uniwork/core/notifications";
import type { Notification } from "@uniwork/core/types";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { groupInbox, type InboxGroupKey } from "./inbox-groups";
import { InboxToolbar, type CategoryFilter, type ReadFilter } from "./inbox-toolbar";
import { inboxCategory, unreadByCategory } from "./notification-category";
import { NotificationRow, ROW_FOCUS_SELECTOR } from "./notification-row";
import { resourceHref } from "./resource-href";
import { useNow } from "./use-now";
import { useUndoableTriage } from "./use-undoable-triage";

/** The mail keys, shown under the list on wide screens. */
const KEY_HINTS: [string[], string][] = [
  [["j", "k"], "notifications.keys_move"],
  [["↵"], "notifications.keys_open"],
  [["r"], "notifications.keys_read"],
  [["e"], "notifications.keys_archive"],
];

/** The reading column: wide enough for a two-line sentence, narrow enough that the eye never crosses an empty band. */
const COLUMN = "mx-auto w-full max-w-5xl px-2 md:px-4";

/**
 * The inbox: this workspace's notifications, unread first, then what was
 * already seen by day. Opening a row marks it read; nothing is marked by
 * merely looking. j/k move, Enter opens, r toggles read, e archives — the
 * same keys as mail.
 *
 * "Current" is simply the row that holds focus. The keys move real focus
 * between the rows' links, so Tab, the mouse and j/k never disagree, and
 * the row actions stay in the tab order instead of behind a listbox.
 * Archive and "mark all as read" are undone from their toast.
 *
 * The category filter narrows the rows already loaded; the server has no
 * kind filter, so an empty category with older pages behind it says so and
 * offers them rather than claiming there is nothing.
 */
export function InboxView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const now = useNow();
  const [read, setRead] = useState<ReadFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("any");
  const listRef = useRef<HTMLUListElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Rows whose read state was toggled here keep the group they were in, so
  // `r` never pulls the focused row out from under the keyboard. The hold
  // lasts while focus stays in the list; once it leaves (or a filter swaps
  // the list), every row goes back to the group its state says.
  const [pinned, setPinned] = useState<ReadonlyMap<string, InboxGroupKey>>(() => new Map());
  const unpin = () => setPinned((prev) => (prev.size === 0 ? prev : new Map()));

  const list = useNotificationPages({ workspaceId: workspace.id, unreadOnly: read === "unread" });
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const triage = useUndoableTriage();

  const loaded = useMemo(() => list.data?.pages.flatMap((p) => p.notifications) ?? [], [list.data]);
  const unreadHere = unread.data?.by_workspace[workspace.id] ?? 0;
  // Per-category counts only when every unread row is in hand.
  const unreadCounts = useMemo(() => {
    const counts = unreadByCategory(loaded);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return total === unreadHere ? counts : undefined;
  }, [loaded, unreadHere]);
  const rows = useMemo(
    () => (category === "any" ? loaded : loaded.filter((n) => inboxCategory(n.kind) === category)),
    [loaded, category],
  );
  const groups = useMemo(() => groupInbox(rows, now, pinned), [rows, now, pinned]);
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  const fail = () => toast.error(t("notifications.error"));
  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate([n.id], { onError: fail });
  };
  const toggleRead = (n: Notification) => {
    const group = groups.find((g) => g.rows.includes(n))?.key;
    if (group && pinned.get(n.id) !== group) setPinned((prev) => new Map(prev).set(n.id, group));
    (n.read_at ? markUnread : markRead).mutate([n.id], { onError: fail });
  };
  const changeRead = (next: ReadFilter) => {
    unpin();
    setRead(next);
  };
  const changeCategory = (next: CategoryFilter) => {
    unpin();
    setCategory(next);
  };
  const onListBlur = (e: FocusEvent<HTMLUListElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) unpin();
  };

  // Moves focus to the nearest row with a link from `from` in `dir`; rows
  // whose resource is gone have none and are stepped over. False when there
  // is no such row.
  const focusRow = (from: number, dir: 1 | -1): boolean => {
    for (let i = from + dir; i >= 0 && i < ordered.length; i += dir) {
      const n = ordered[i];
      if (!n || n.resource_deleted) continue;
      const el = listRef.current?.querySelector<HTMLElement>(`[data-notification-id="${n.id}"] ${ROW_FOCUS_SELECTOR}`);
      if (!el) continue;
      el.focus();
      el.scrollIntoView?.({ block: "nearest" });
      return true;
    }
    return false;
  };

  // The archived row takes focus with it; the next row inherits it, the last
  // row hands it back up, and the only row hands it to the filters, so focus
  // never falls to the page body.
  const archiveAndMove = (n: Notification, idx: number) => {
    triage.archiveRow(n);
    if (focusRow(idx, 1) || focusRow(idx, -1)) return;
    toolbarRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
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
        archiveAndMove(current, idx);
        break;
      default:
        break;
    }
  };

  const settingsHref = `${paths.workspace(workspace.organization_slug, workspace.slug).settings()}?tab=notifications`;
  const olderButton = list.hasNextPage ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={list.isFetchingNextPage}
      onClick={() => void list.fetchNextPage()}
    >
      {list.isFetchingNextPage ? t("notifications.loading_older") : t("notifications.load_older")}
    </Button>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Inbox}
        tone={moduleTone("inbox")}
        title={t("nav.inbox")}
        count={unreadHere}
        countLabel={t("notifications.category_unread", { count: unreadHere })}
        actions={
          <>
            <AppLink
              href={settingsHref}
              aria-label={t("notifications.empty_settings")}
              title={t("notifications.empty_settings")}
              className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "pointer-coarse:size-11" })}
            >
              <Settings aria-hidden className="size-4" />
            </AppLink>
            <CollectionPageHeaderAction
              icon={CheckCheck}
              label={t("notifications.mark_all_read")}
              disabled={unreadHere === 0 || triage.markingAll}
              onClick={() => triage.markAllRead(workspace.id)}
            />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(COLUMN, "pt-3 pb-1")}>
          <InboxToolbar
            ref={toolbarRef}
            category={category}
            onCategory={changeCategory}
            read={read}
            onRead={changeRead}
            unreadCounts={unreadCounts}
            unreadTotal={unreadHere}
          />
        </div>
        {list.isLoading ? (
          <InboxSkeleton />
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
        ) : ordered.length === 0 && category !== "any" && loaded.length > 0 ? (
          <CollectionPageState
            icon={ListFilter}
            tone={moduleTone("inbox")}
            role="status"
            title={t("notifications.empty_category_title")}
            description={list.hasNextPage ? t("notifications.empty_category_more") : t("notifications.empty_category_description")}
            actions={
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => changeCategory("any")}>
                  {t("notifications.show_any_category")}
                </Button>
                {olderButton}
              </>
            }
          />
        ) : ordered.length === 0 ? (
          <CollectionPageState
            icon={Inbox}
            tone={moduleTone("inbox")}
            role="status"
            title={read === "unread" ? t("notifications.empty_unread_title") : t("notifications.empty_title")}
            description={t("notifications.empty_description")}
            actions={
              <AppLink href={settingsHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Settings aria-hidden className="size-4" />
                {t("notifications.empty_settings")}
              </AppLink>
            }
          />
        ) : (
          <div className={cn(COLUMN, "pb-6")}>
            {/* Keyed by the filters: switching them swaps the list outright,
                so only an archive plays the rows' exit. */}
            <ul
              key={`${read}:${category}`}
              ref={listRef}
              aria-label={t("nav.inbox")}
              onBlur={onListBlur}
              className="[--row-fill:var(--background)]"
            >
              {groups.map((g) => (
                <GroupSection key={g.key} group={g.key} count={g.rows.length}>
                  {g.rows.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      href={resourceHref(n, workspace)}
                      onOpen={open}
                      onToggleRead={toggleRead}
                      onArchive={(row) => archiveAndMove(row, ordered.indexOf(row))}
                      onKeyDown={onRowKeyDown}
                    />
                  ))}
                </GroupSection>
              ))}
            </ul>
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 pt-4">
              <p className="hidden items-center gap-3 text-caption text-muted-foreground md:flex">
                {KEY_HINTS.map(([keys, label]) => (
                  <span key={label} className="flex items-center gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                    <span>{t(label)}</span>
                  </span>
                ))}
              </p>
              {olderButton ?? <p className="text-caption text-muted-foreground">{t("notifications.end_of_list")}</p>}
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A group's label and its rows. The label's `li` is presentational so the
 * list stays one flat list for j/k and its item count is the rows'; the label
 * inside is a real heading, so a screen reader can jump group to group and
 * hears what each holds. It sticks while its rows scroll under it, on the
 * page's own solid fill.
 */
function GroupSection({ group, count, children }: { group: InboxGroupKey; count: number; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <li role="presentation" className="sticky top-0 z-10 bg-background px-3 pt-4 pb-1.5">
        <h2 className="flex items-baseline gap-2 text-overline text-muted-foreground">
          <span>{t(`notifications.group_${group}`)}</span>
          <span aria-hidden className="tabular-nums">
            {count}
          </span>
          <span className="sr-only">{`, ${t("notifications.group_count", { count })}`}</span>
        </h2>
      </li>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </>
  );
}

/** The loading shape is the row's shape: a face, a sentence, a time. */
function InboxSkeleton() {
  const { t } = useTranslation();
  const widths = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-3/5"];
  return (
    <div className={cn(COLUMN, "pt-4")} role="status" aria-busy>
      <span className="sr-only">{t("notifications.loading")}</span>
      <Skeleton className="mx-3 mb-3 h-3 w-20" />
      {widths.map((w, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
