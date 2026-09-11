"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { AppLink, useNavigation } from "../navigation";
import { NotificationRow } from "./notification-row";
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
 */
export function InboxView() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (selectedId && !ordered.some((n) => n.id === selectedId)) setSelectedId(null);
  }, [ordered, selectedId]);

  const fail = () => toast.error(t("notifications.error"));
  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate([n.id], { onError: fail });
  };
  const toggleRead = (n: Notification) => {
    (n.read_at ? markUnread : markRead).mutate([n.id], { onError: fail });
  };
  const doArchive = (n: Notification) => archive.mutate([n.id], { onError: fail });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (ordered.length === 0) return;
    const idx = ordered.findIndex((n) => n.id === selectedId);
    const move = (next: number) => {
      const n = ordered[Math.max(0, Math.min(ordered.length - 1, next))];
      if (!n) return;
      setSelectedId(n.id);
      listRef.current?.querySelector<HTMLElement>(`[data-notification-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" });
    };
    const current = idx >= 0 ? ordered[idx] : undefined;
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        move(idx + 1);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        move(idx - 1);
        break;
      case "Enter":
        if (current && !current.resource_deleted) {
          e.preventDefault();
          open(current);
          push(resourceHref(current, workspace));
        }
        break;
      case "r":
        if (current) {
          e.preventDefault();
          toggleRead(current);
        }
        break;
      case "e":
        if (current) {
          e.preventDefault();
          doArchive(current);
          move(idx + 1 < ordered.length ? idx + 1 : idx - 1);
        }
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
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="all">{t("notifications.filter_all")}</ToggleGroupItem>
              <ToggleGroupItem value="unread">{t("notifications.filter_unread")}</ToggleGroupItem>
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
          <ul
            ref={listRef}
            role="listbox"
            aria-label={t("nav.inbox")}
            aria-activedescendant={selectedId ?? undefined}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {groups.unread.length > 0 ? <GroupLabel>{t("notifications.group_unread")}</GroupLabel> : null}
            {groups.unread.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                selected={n.id === selectedId}
                onOpen={open}
                onToggleRead={toggleRead}
                onArchive={doArchive}
              />
            ))}
            {groups.earlier.length > 0 ? <GroupLabel>{t("notifications.group_earlier")}</GroupLabel> : null}
            {groups.earlier.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                selected={n.id === selectedId}
                onOpen={open}
                onToggleRead={toggleRead}
                onArchive={doArchive}
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
    <li role="presentation" className="sticky top-0 z-10 bg-background/95 px-3 pt-3 pb-1 text-caption font-medium text-muted-foreground backdrop-blur">
      {children}
    </li>
  );
}
