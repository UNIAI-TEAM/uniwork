"use client";

import { useRef } from "react";
import {
  CalendarDays,
  ChevronsUpDown,
  Cpu,
  FolderKanban,
  Inbox,
  ListTodo,
  LogOut,
  MessageSquare,
  Settings,
  SquareCheckBig,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { useFlag } from "@uniwork/core/feature-flags";
import { useUnreadCount } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { useScrollFade } from "@uniwork/ui/hooks/use-scroll-fade";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { SearchTrigger } from "../search";
import { useWorkspace } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface NavItem {
  key: "nav.inbox" | "nav.tasks" | "nav.my_tasks" | "nav.projects" | "nav.squads" | "nav.runtimes" | "nav.meetings" | "nav.chat" | "nav.people";
  href: string;
  icon: LucideIcon;
  badge?: number;
}

const navButtonClass =
  "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground";

/** First letter of the first word, which is all an avatar has room for at 32px. */
function initialOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * Workspace navigation on the inset shell: floating content card beside a
 * padded sidebar rail. PRODUCT.md keeps the nav to built surfaces only —
 * tasks, meetings, members — but the chrome matches the reference layout.
 */
export function AppSidebar() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const { pathname, replace } = useNavigation();
  const { isCompact, setOpenMobile } = useSidebar();
  const logout = useAuthStore((s) => s.logout);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const unread = useUnreadCount();
  const unreadHere = unread.data?.by_workspace[workspace.id] ?? 0;
  const parity = useFlag("tasks_work_management_parity", false);

  const items: NavItem[] = [
    { key: "nav.inbox", href: ws.inbox(), icon: Inbox, badge: unreadHere },
    { key: "nav.tasks", href: ws.tasks(), icon: SquareCheckBig },
    ...(parity
      ? [
          { key: "nav.my_tasks" as const, href: ws.myTasks(), icon: ListTodo },
          { key: "nav.projects" as const, href: ws.projects(), icon: FolderKanban },
          { key: "nav.squads" as const, href: ws.squads(), icon: UsersRound },
          { key: "nav.runtimes" as const, href: ws.runtimes(), icon: Cpu },
        ]
      : []),
    { key: "nav.meetings", href: ws.meetings(), icon: CalendarDays },
    { key: "nav.chat", href: ws.chat(), icon: MessageSquare },
    { key: "nav.people", href: ws.people(), icon: Users },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const dismissSheet = () => {
    if (isCompact) setOpenMobile(false);
  };

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-1 py-2 group-data-[collapsible=icon]:px-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher current={workspace} onNavigate={dismissSheet} />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SearchTrigger />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
        <nav aria-label={t("nav.workspace_group")} className="flex flex-col">
          <SidebarGroup className="group-data-[collapsible=icon]:px-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {items.map(({ key, href, icon: Icon, badge }) => {
                  const active = isActive(href);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={t(key)}
                        className={navButtonClass}
                        render={
                          <AppLink
                            href={href}
                            aria-current={active ? "page" : undefined}
                            onClick={dismissSheet}
                          />
                        }
                      >
                        <Icon aria-hidden />
                        <span>{t(key)}</span>
                        {badge ? (
                          <SidebarMenuBadge aria-label={t("notifications.bell_unread", { count: badge })}>
                            {badge > 99 ? "99+" : badge}
                          </SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="p-2 group-data-[collapsible=icon]:px-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label={t("nav.account")}
                    tooltip={user.display_name}
                    className={cn(navButtonClass, "data-[popup-open]:bg-sidebar-accent")}
                  />
                }
              >
                <ActorAvatar
                  name={user.display_name}
                  initials={initialOf(user.display_name)}
                  size="lg"
                  className="bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-border"
                />
                <span className="min-w-0 flex-1 truncate text-left text-body font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                  {user.display_name}
                </span>
                <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-faint-foreground group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium text-foreground">{user.display_name}</span>
                    <span className="truncate font-normal text-caption text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    render={
                      <AppLink href={ws.settings()} onClick={dismissSheet} />
                    }
                  >
                    <Settings aria-hidden />
                    {t("nav.settings")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      dismissSheet();
                      try {
                        await logout();
                      } finally {
                        replace(paths.login());
                      }
                    }}
                  >
                    <LogOut aria-hidden />
                    {t("auth.logout")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
