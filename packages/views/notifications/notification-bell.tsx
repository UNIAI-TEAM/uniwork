"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useArchive, useMarkRead, useMarkUnread, useNotifications, useUnreadCount } from "@uniwork/core/notifications";
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
  // Fetched only while open so the bell costs one request at boot, not two.
  const list = useNotifications({ workspaceId: workspace.id, limit: 10 });
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const archive = useArchive();
  const label = count > 0 ? t("notifications.bell_unread", { count }) : t("notifications.bell");
  const inboxHref = paths.workspace(workspace.organization_slug, workspace.slug).inbox();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button type="button" variant="ghost" size="icon-sm" className="relative h-8 w-8" aria-label={label} />}
            />
          }
        >
          <Bell aria-hidden className="size-4 text-muted-foreground" />
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-body font-medium">{t("nav.inbox")}</span>
          <AppLink href={inboxHref} onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("notifications.view_all")}
          </AppLink>
        </div>
        {list.data && list.data.notifications.length > 0 ? (
          <ul role="listbox" className="max-h-96 overflow-y-auto" aria-label={t("nav.inbox")}>
            {list.data.notifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                compact
                onOpen={(row) => {
                  setOpen(false);
                  if (!row.read_at) markRead.mutate([row.id]);
                }}
                onToggleRead={(row) => (row.read_at ? markUnread : markRead).mutate([row.id])}
                onArchive={(row) => archive.mutate([row.id])}
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
