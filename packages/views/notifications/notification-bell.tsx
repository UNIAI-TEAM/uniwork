"use client";

import { useState } from "react";
import { Bell, CheckCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import { useMarkRead, useNotifications, useUnreadCount } from "@uniwork/core/notifications";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { NotificationRow } from "./notification-row";
import { resourceHref } from "./resource-href";
import { useUndoableTriage } from "./use-undoable-triage";

/** 32px in the header; 44px under a finger. */
const HEADER_ACTION = "pointer-coarse:h-11";

/**
 * Top-bar bell: unread count for this workspace, the ten newest rows, and
 * "see all". A list that failed to load says so and offers a retry: an
 * empty-looking bell would tell the person nothing is waiting when it may be.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const count = unread.data?.by_workspace[workspace.id] ?? 0;
  // Cold until opened, so the bell costs one request at boot (the count), not two.
  const list = useNotifications({ workspaceId: workspace.id, limit: 10, enabled: open });
  const markRead = useMarkRead();
  const triage = useUndoableTriage();
  const fail = () => toast.error(t("notifications.error"));
  const rows = list.data?.notifications ?? [];
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
                className={HEADER_ACTION}
                disabled={triage.markingAll}
                onClick={() => triage.markAllRead(workspace.id)}
              >
                <CheckCheck aria-hidden className="size-3.5" />
                {t("notifications.mark_all_read")}
              </Button>
            ) : null}
            <AppLink
              href={inboxHref}
              onClick={() => setOpen(false)}
              className={buttonVariants({ variant: "ghost", size: "sm", className: HEADER_ACTION })}
            >
              {t("notifications.view_all")}
            </AppLink>
          </span>
        </div>
        {rows.length > 0 ? (
          <ul className="max-h-112 overflow-y-auto p-1 [--row-fill:var(--popover)]" aria-label={t("nav.inbox")}>
            {rows.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                href={resourceHref(n, workspace)}
                compact
                onOpen={(row) => {
                  setOpen(false);
                  if (!row.read_at) markRead.mutate([row.id], { onError: fail });
                }}
              />
            ))}
          </ul>
        ) : list.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-3 py-6 text-center">
            <p className="flex items-center gap-2 text-caption text-destructive">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              {t("notifications.error_title")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={HEADER_ACTION}
              disabled={list.isFetching}
              onClick={() => void list.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : list.isLoading ? (
          <BellSkeleton />
        ) : (
          <p className="px-3 py-6 text-center text-caption text-muted-foreground">{t("notifications.empty_title")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Three compact rows' worth of shape while the ten newest load. */
function BellSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy className="p-1">
      <span className="sr-only">{t("notifications.loading")}</span>
      {["w-3/4", "w-2/3", "w-1/2"].map((w) => (
        <div key={w} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className={`h-3.5 ${w}`} />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
