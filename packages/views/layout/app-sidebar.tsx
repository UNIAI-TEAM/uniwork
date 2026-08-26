"use client";

import { CalendarDays, ChevronsUpDown, LogOut, SquareCheckBig, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@uniwork/ui/components/ui/sidebar";
import { AppLink, useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface NavItem {
  key: "nav.tasks" | "nav.meetings" | "nav.members";
  href: string;
  icon: LucideIcon;
}

/** First letter of the first word, which is all an avatar has room for at 32px. */
function initialOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * The workspace navigation. One group today — the sections that exist —
 * shaped so a second group (knowledge, automation, insights) is an addition
 * here rather than a redesign. PRODUCT.md forbids advertising surfaces that
 * do not exist, so nothing is listed ahead of being built.
 *
 * `collapsible="icon"`, not `"offcanvas"`: the provider auto-collapses across
 * the `lg`–`xl` band, and offcanvas turned that into the nav disappearing
 * outright on any laptop-width window — a state the header trigger was the
 * only way out of. An icon rail spends 48px instead of 256px and keeps the
 * sections reachable and the current one visible, which is the whole point of
 * collapsing rather than hiding.
 *
 * There is no visible group label. With one group it only repeated the
 * workspace name from the switcher directly above it, and `docs/conventions.md`
 * keeps "workspace" in English while that label translated it. It lives on as
 * the accessible name of the `<nav>` landmark, which is where a single group
 * actually needs a name.
 */
export function AppSidebar() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const { pathname, replace } = useNavigation();
  const { isCompact, setOpenMobile } = useSidebar();
  const logout = useAuthStore((s) => s.logout);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  const items: NavItem[] = [
    { key: "nav.tasks", href: ws.tasks(), icon: SquareCheckBig },
    { key: "nav.meetings", href: ws.meetings(), icon: CalendarDays },
    { key: "nav.members", href: ws.members(), icon: Users },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Below `lg` the nav is a sheet over the page. Navigating without closing it
  // leaves the destination behind an overlay the user has to dismiss by hand,
  // so every item that navigates closes it on the way out.
  const dismissSheet = () => {
    if (isCompact) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Decorative: the workspace switcher directly below carries the
            accessible name for this region, and announcing "UniWork" ahead of
            it would put the product name between the user and their own
            workspace on every screen. */}
        <div className="flex h-8 items-center px-2 group-data-[collapsible=icon]:hidden">
          <Logo variant="mark" size={20} decorative />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher current={workspace} onNavigate={dismissSheet} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t("nav.workspace_group")} className="flex flex-col">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map(({ key, href, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={t(key)}
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
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The name used to sit here as inert muted text with a bare
                "log out" button beside it — the one permanently-mounted
                control in the chrome was the one that throws the session
                away. Behind a menu it takes an extra, deliberate click, and
                the row it replaces becomes where account actions go. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label={t("nav.account")}
                    tooltip={user.display_name}
                    className="group-data-[collapsible=icon]:justify-center data-[popup-open]:bg-sidebar-accent"
                  />
                }
              >
                {/* `--muted` and `--sidebar` are the same value in both modes,
                    so ActorAvatar's default fallback disc is invisible here and
                    the initial reads as a loose letter. The accent surface plus
                    a hairline is the one pairing that renders as a disc against
                    the rail without spending brand colour on it — that is the
                    workspace tile's job, one row up. */}
                <ActorAvatar
                  name={user.display_name}
                  initials={initialOf(user.display_name)}
                  size="lg"
                  className="bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-border"
                />
                <span className="min-w-0 flex-1 truncate text-left text-body font-medium text-sidebar-foreground group-data-[collapsible=icon]:hidden">
                  {user.display_name}
                </span>
                <ChevronsUpDown
                  aria-hidden
                  className="size-4 shrink-0 text-faint-foreground group-data-[collapsible=icon]:hidden"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-56">
                {/* Base UI requires a label to sit inside a group, and it is
                    the right shape anyway: the identity is what the actions
                    below it apply to. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium text-foreground">{user.display_name}</span>
                    <span className="truncate font-normal text-caption text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      dismissSheet();
                      await logout();
                      replace(paths.login());
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
