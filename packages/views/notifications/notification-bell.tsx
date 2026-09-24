"use client";

import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import { useArchive, useMarkAllRead, useMarkRead, useMarkUnread, useNotifications, useUnreadCount } from "@uniwork/core/notifications";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { NotificationRow } from "./notification-row";
import { resourceHref } from "./resource-href";

/** Top-bar bell: unread count for this workspace, the ten newest rows, and "see all". */
export function NotificationBell() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const count = unread.data?.by_workspace[workspace.id] ?? 0;
  // Cold until opened, so the bell costs one request at boot (the count), not two.
  const list = useNotifications({ workspaceId: workspace.id, limit: 10, enabled: open });
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const archive = useArchive();
  const markAll = useMarkAllRead();
  const fail = () => toast.error(t("notifications.error"));
  const label = count > 0 ? t("notifications.bell_unread", { count }) : t("notifications.bell");
  const inboxHref = paths.workspace(workspace.organization_slug, workspace.slug).inbox();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                // 32px in the bar; a 44px target under a finger (pointer-coarse), which the 48px bar still holds.
                <Button type="button" variant="ghost" size="icon" className="relative pointer-coarse:size-11" aria-label={label} />
              }
            />
          }
        >
          <Bell aria-hidden className="size-4 text-muted-foreground" />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-micro leading-none font-semibold tabular-nums text-primary-foreground"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-body font-medium">{t("nav.inbox")}</span>
            {count > 0 ? (
              <span className="font-mono text-caption tabular-nums text-muted-foreground">{count > 99 ? "99+" : count}</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {count > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate(workspace.id, { onError: fail })}
              >
                <CheckCheck aria-hidden className="size-3.5" />
                {t("notifications.mark_all_read")}
              </Button>
            ) : null}
            <AppLink href={inboxHref} onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("notifications.view_all")}
            </AppLink>
          </span>
        </div>
        {list.data && list.data.notifications.length > 0 ? (
          <ul className="max-h-[28rem] overflow-y-auto p-1 [--row-fill:var(--popover)]" aria-label={t("nav.inbox")}>
            {list.data.notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                compact
                onOpen={(row) => {
                  setOpen(false);
                  if (!row.read_at) markRead.mutate([row.id], { onError: fail });
                }}
                onToggleRead={(row) => (row.read_at ? markUnread : markRead).mutate([row.id], { onError: fail })}
                onArchive={(row) => archive.mutate([row.id], { onError: fail })}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-caption text-muted-foreground">
            {list.isLoading ? t("common.loading") : t("notifications.empty_title")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
