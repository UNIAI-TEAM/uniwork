"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatUnreadSummary } from "@uniwork/core/chat";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useUnreadCount } from "@uniwork/core/notifications";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";
import { useNavigation } from "../navigation";
import { WorkspaceIcon } from "./workspace-icon";

/**
 * Organization › current workspace: the top bar's start on a desktop shell (as
 * in ClickUp), the phone sheet's header otherwise. The menu groups every
 * workspace the user can see by organization and ends with "new workspace".
 * Switching is an in-app push, not a reload — the layout resolves the new
 * pair and the realtime provider reconnects on its own.
 */
export function WorkspaceSwitcher({
  current,
  onNavigate,
  placement = "sidebar",
}: {
  current: Workspace;
  onNavigate?: () => void;
  placement?: "sidebar" | "header";
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const { data: workspaces = [] } = useWorkspaces();
  const unread = useUnreadCount();
  const unreadIn = (id: string) => unread.data?.by_workspace[id] ?? 0;
  const elsewhere = workspaces.some((w) => w.id !== current.id && unreadIn(w.id) > 0);
  const chat = useChatUnreadSummary().data?.workspaces;

  const go = (href: string) => {
    onNavigate?.();
    push(href);
  };

  const groups = new Map<string, { name: string; items: Workspace[] }>();
  for (const w of workspaces) {
    const g = groups.get(w.organization_id) ?? { name: w.organization_name, items: [] };
    g.items.push(w);
    groups.set(w.organization_id, g);
  }

  // Starts with the names on the button (WCAG 2.5.3), then says what it does.
  // The unread-elsewhere dot is inside a label-overridden button, so its own
  // label was never read; the fact rides on the name instead.
  const label = [
    t("org.switch_named", { organization: current.organization_name, workspace: current.name }),
    elsewhere ? t("notifications.unread_elsewhere") : null,
  ]
    .filter(Boolean)
    .join(". ");
  const header = placement === "header";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          header ? (
            <Button type="button" variant="ghost" aria-label={label} className="h-8 max-w-72 min-w-0 gap-2 px-1.5" />
          ) : (
            <SidebarMenuButton size="lg" aria-label={label} tooltip={current.name} className="gap-2.5 px-2" />
          )
        }
      >
        {/* aria-hidden: its meaning (workspace icon, unread dot) is in the
            aria-label, and the menu-button primitive would otherwise make it
            sr-only in an icon rail. */}
        <span aria-hidden className="relative shrink-0">
          <WorkspaceIcon
            workspace={current}
            className={cn(
              "bg-sidebar-primary font-semibold text-sidebar-primary-foreground",
              // The header's matches a module tile (IconTile xs), so the bar and the nav read at one size.
              header
                ? "size-5 rounded-[5px] text-caption"
                : "size-8 rounded-lg text-body group-data-[collapsible=icon]:size-6 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:text-caption",
            )}
          />
          {elsewhere ? (
            <span
              className={cn(
                "absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2",
                // The dot is cut out of the plane the control sits on: the header's is the app shell.
                header ? "ring-app-shell" : "ring-surface group-data-[collapsible=icon]:ring-app-shell",
              )}
            />
          ) : null}
        </span>
        {header ? (
          // One line at a nav row's size. A person is in one organization (ADR 0032), so its name rides on the
          // button's label and the menu's group heading instead of a second line.
          <span
            title={`${current.organization_name} › ${current.name}`}
            className="min-w-0 truncate text-body font-medium text-foreground"
          >
            {current.name}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
            <span title={current.organization_name} className="block truncate text-caption text-muted-foreground">
              {current.organization_name}
            </span>
            <span title={current.name} className="block truncate text-body font-semibold text-sidebar-foreground">
              {current.name}
            </span>
          </span>
        )}
        <ChevronDown aria-hidden className="ml-auto size-3! text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-80 min-w-60">
        {[...groups.entries()].map(([orgId, g]) => (
          <DropdownMenuGroup key={orgId}>
            <DropdownMenuLabel>{g.name}</DropdownMenuLabel>
            {g.items.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => go(paths.workspace(w.organization_slug, w.slug).tasks())}
              >
                <WorkspaceIcon
                  workspace={w}
                  className="size-5 rounded-sm bg-muted text-caption font-semibold text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", w.id === current.id && "font-medium")}>{w.name}</span>
                  {w.description ? (
                    <span className="block truncate text-caption text-muted-foreground">{w.description}</span>
                  ) : null}
                </span>
                {w.id !== current.id ? (
                  <WorkspaceUnread
                    notifications={unreadIn(w.id)}
                    chat={chat?.find((c) => c.workspace_id === w.id)}
                  />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => go(paths.newWorkspace())}>
          <Plus aria-hidden className="size-4" />
          {t("workspace.new")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Another workspace's news on its menu row: its channels' unread count as a
 * pill (red when someone mentioned the reader), else a dot for unread
 * notifications. Dms and groups show in every workspace, so they are not
 * counted here. The current workspace has its own Chat and Inbox badges.
 */
function WorkspaceUnread({
  notifications,
  chat,
}: {
  notifications: number;
  chat?: { unread: number; mentions: number };
}) {
  const { t } = useTranslation();
  const unread = chat?.unread ?? 0;
  const mentions = chat?.mentions ?? 0;
  if (unread <= 0 && notifications <= 0) return null;
  const label = [
    unread > 0 ? t("chat.unread_badge_aria", { count: unread }) : null,
    mentions > 0 ? t("chat.mention_unread_badge_aria", { count: mentions }) : null,
    notifications > 0 ? t("notifications.bell_unread", { count: notifications }) : null,
  ]
    .filter(Boolean)
    .join(". ");
  if (unread <= 0) {
    return <span role="img" aria-label={label} className="size-2 shrink-0 rounded-full bg-primary" />;
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "shrink-0 rounded-full px-1.5 text-caption font-semibold tabular-nums",
        mentions > 0 ? "bg-destructive-solid text-on-solid" : "bg-primary text-primary-foreground",
      )}
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}
