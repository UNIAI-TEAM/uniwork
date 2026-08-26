"use client";

import { CalendarDays, LogOut, SquareCheckBig, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@uniwork/ui/components/ui/sidebar";
import { AppLink, useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface NavItem {
  key: "nav.tasks" | "nav.meetings" | "nav.members";
  href: string;
  icon: LucideIcon;
}

/**
 * The workspace navigation. One group today — the sections that exist —
 * shaped so a second group (knowledge, automation, insights) is an addition
 * here rather than a redesign. PRODUCT.md forbids advertising surfaces that
 * do not exist, so nothing is listed ahead of being built.
 */
export function AppSidebar() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const { pathname, replace } = useNavigation();
  const logout = useAuthStore((s) => s.logout);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  const items: NavItem[] = [
    { key: "nav.tasks", href: ws.tasks(), icon: SquareCheckBig },
    { key: "nav.meetings", href: ws.meetings(), icon: CalendarDays },
    { key: "nav.members", href: ws.members(), icon: Users },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        {/* Decorative: the workspace switcher directly below carries the
            accessible name for this region, and announcing "UniWork" ahead of
            it would put the product name between the user and their own
            workspace on every screen. */}
        <div className="flex h-8 items-center px-2">
          <Logo variant="mark" size={20} decorative />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher current={workspace} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.workspace_group")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(({ key, href, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={active}
                      render={<AppLink href={href} aria-current={active ? "page" : undefined} />}
                    >
                      <Icon aria-hidden />
                      <span>{t(key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="truncate px-2 py-1 text-caption text-muted-foreground">{user.display_name}</div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={async () => {
                await logout();
                replace(paths.login());
              }}
            >
              <LogOut aria-hidden />
              <span>{t("auth.logout")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
