"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useUnreadCount } from "@uniwork/core/notifications";
import { useWorkspaces } from "@uniwork/core/workspaces";
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

/**
 * Sidebar header: organization › current workspace. The menu groups every
 * workspace the user can see by organization and ends with "new workspace".
 * Switching is an in-app push, not a reload — the layout resolves the new
 * pair and the realtime provider reconnects on its own.
 *
 * The initial tile is not decoration: in the collapsed icon rail it is the
 * only thing left of this control, and a rail whose top slot is blank reads
 * as a broken header rather than a nav.
 */
export function WorkspaceSwitcher({
  current,
  onNavigate,
}: {
  current: Workspace;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const { push } = useNavigation();
  const { data: workspaces = [] } = useWorkspaces();
  const unread = useUnreadCount();
  const unreadIn = (id: string) => unread.data?.by_workspace[id] ?? 0;
  const elsewhere = workspaces.some((w) => w.id !== current.id && unreadIn(w.id) > 0);

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            // Starts with the names on the button (WCAG 2.5.3), then says what it does.
            // The unread-elsewhere dot is inside a label-overridden button, so
            // its own label was never read; the fact rides on the name instead.
            aria-label={[
              t("org.switch_named", { organization: current.organization_name, workspace: current.name }),
              elsewhere ? t("notifications.unread_elsewhere") : null,
            ]
              .filter(Boolean)
              .join(". ")}
            tooltip={current.name}
            className="gap-2.5 px-2"
          />
        }
      >
        {/* aria-hidden, which also keeps it visible in the icon rail: the
            menu-button primitive makes every other direct span child
            sr-only there, and the rail was once left with no workspace mark
            at all. Its meaning (initial, unread dot) is in the aria-label. */}
        <span aria-hidden className="relative shrink-0">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-body font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:size-6 group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:text-caption"
          >
            {current.name.trim().slice(0, 1).toUpperCase()}
          </span>
          {elsewhere ? (
            <span
              className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-surface group-data-[collapsible=icon]:ring-app-shell"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
          <span title={current.organization_name} className="block truncate text-caption text-muted-foreground">
            {current.organization_name}
          </span>
          <span title={current.name} className="block truncate text-body font-semibold text-sidebar-foreground">
            {current.name}
          </span>
        </span>
        <ChevronDown aria-hidden className="ml-auto size-3! text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {[...groups.entries()].map(([orgId, g]) => (
          <DropdownMenuGroup key={orgId}>
            <DropdownMenuLabel>{g.name}</DropdownMenuLabel>
            {g.items.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => go(paths.workspace(w.organization_slug, w.slug).tasks())}
                className={cn(w.id === current.id && "font-medium")}
              >
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id !== current.id && unreadIn(w.id) > 0 ? (
                  <span
                    role="img"
                    aria-label={t("notifications.bell_unread", { count: unreadIn(w.id) })}
                    className="size-2 shrink-0 rounded-full bg-primary"
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
