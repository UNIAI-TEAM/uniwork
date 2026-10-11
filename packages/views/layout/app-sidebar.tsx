"use client";

import { Fragment, useId, useRef } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { useFlag } from "@uniwork/core/feature-flags";
import { useChatUnreadBadge } from "@uniwork/core/chat";
import { useEmailHubUnreadCount } from "@uniwork/core/email-hub/hooks";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@uniwork/ui/components/ui/sidebar";
import { UI_EASE_SETTLE, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { AppLink, useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { MODULE_ICONS } from "./module-icons";
import { moduleTone, type ModuleKey } from "./module-tones";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { pinHref, SidebarPins, useSidebarPins } from "./sidebar-pins";

interface NavItem {
  key: "nav.home" | "nav.inbox" | "nav.email" | "nav.tasks" | "nav.my_tasks" | "nav.projects" | "nav.calendar" | "nav.meetings" | "nav.documents" | "nav.chat" | "nav.people";
  /** Names the item's glyph (module-icons.ts) and tint (module-tones.ts). */
  module: ModuleKey;
  href: string;
  badge?: number;
  /** Active only on this exact path; the workspace root prefixes every other route. */
  exact?: boolean;
}

interface NavGroup {
  id: string;
  /** No label for the lead group: Home and Inbox are where a day starts, not a category. */
  label?: "nav.group_work" | "nav.group_communication";
  items: NavItem[];
}

const navButtonClass =
  "isolate h-9 rounded-md text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-transparent data-active:font-medium data-active:text-sidebar-accent-foreground data-active:hover:bg-transparent";

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
  const { mutateAsync: logout } = useLogout();
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  // Documents is feature-flagged: the nav entry appears only where the
  // workspace has the module, so a hidden route is not advertised.
  const documentsEnabled = useFlag("documents", false);
  const unread = useUnreadCount();
  const unreadHere = unread.data?.by_workspace[workspace.id] ?? 0;
  const emailUnread = useEmailHubUnreadCount(workspace.id);
  const emailUnreadHere = emailUnread.data?.unread ?? 0;
  const chatUnread = useChatUnreadBadge(workspace.id);
  const labelId = useId();
  const reduceMotion = useReducedMotion() ?? false;

  const groups: NavGroup[] = [
    {
      id: "lead",
      items: [
        { key: "nav.home", module: "home", href: ws.root(), exact: true },
        { key: "nav.inbox", module: "inbox", href: ws.inbox(), badge: unreadHere },
      ],
    },
    {
      id: "work",
      label: "nav.group_work",
      items: [
        { key: "nav.tasks", module: "tasks", href: ws.tasks() },
        { key: "nav.my_tasks", module: "my_tasks", href: ws.myTasks() },
        { key: "nav.projects", module: "projects", href: ws.projects() },
        { key: "nav.calendar", module: "calendar", href: ws.calendar() },
      ],
    },
    {
      id: "communication",
      label: "nav.group_communication",
      items: [
        {
          key: "nav.email",
          module: "email",
          href: ws.email(),
          badge: emailUnreadHere > 0 ? emailUnreadHere : undefined,
        },
        { key: "nav.meetings", module: "meetings", href: ws.meetings() },
        ...(documentsEnabled
          ? ([{ key: "nav.documents", module: "documents", href: ws.documents() }] as NavItem[])
          : []),
        { key: "nav.chat", module: "chat", href: ws.chat(), badge: chatUnread > 0 ? chatUnread : undefined },
        { key: "nav.people", module: "people", href: ws.people() },
      ],
    },
  ];

  const pins = useSidebarPins(workspace.id);
  // An open pinned page is marked on its pin row, not also on its section.
  const onPinnedPage = pins.some((pin) => pathname === pinHref(ws, pin));
  const isActive = (href: string, exact = false) =>
    !onPinnedPage && (pathname === href || (!exact && pathname.startsWith(href + "/")));

  const dismissSheet = () => {
    if (isCompact) setOpenMobile(false);
  };

  return (
    <Sidebar variant="inset" collapsible="icon">
      {/* The switcher shares the top bar's horizon: expanded (48px) it starts
          where the content card does, collapsed (32px) it sits 8px lower, so
          both centres land on the 48px bar's. The sheet keeps its own pad. */}
      <SidebarHeader className="gap-2 px-2 pt-2 pb-1 group-data-[collapsible=icon]:px-0 lg:pt-0 lg:group-data-[collapsible=icon]:pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceSwitcher current={workspace} onNavigate={dismissSheet} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
        <nav aria-label={t("nav.workspace_group")} className="flex flex-col pt-1">
          {groups.map(({ id, label, items }) =>
            items.length === 0 ? null : (
              <Fragment key={id}>
              <SidebarGroup className="py-1 group-data-[collapsible=icon]:px-0">
                {/* The label names its list through `aria-labelledby`, and is
                    itself aria-hidden: read as text too, a screen reader said
                    "Làm việc" twice, and in the icon rail (where the label
                    fades out) it was a stray line between two lists. A
                    reference to a hidden element still yields the name. */}
                {label ? (
                  <SidebarGroupLabel
                    id={`${labelId}-${id}`}
                    aria-hidden
                    className="h-7 px-2 text-overline text-muted-foreground"
                  >
                    {t(label)}
                  </SidebarGroupLabel>
                ) : null}
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5" aria-labelledby={label ? `${labelId}-${id}` : undefined}>
                    {items.map(({ key, module, href, badge, exact }) => {
                      const active = isActive(href, exact);
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
                            {active ? (
                              <motion.span
                                aria-hidden
                                initial={false}
                                layoutId={reduceMotion ? undefined : "sidebar-active-row"}
                                transition={{ duration: UI_MOTION_DURATION.settle, ease: UI_EASE_SETTLE }}
                                data-slot="sidebar-active-indicator"
                                className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-sidebar-accent"
                              />
                            ) : null}
                            <IconTile
                              icon={MODULE_ICONS[module]}
                              size="xs"
                              variant="solid"
                              tone={moduleTone(module)}
                              className="[&_svg]:size-3"
                            />
                            <span>{t(key)}</span>
                            {badge ? (
                              <SidebarMenuBadge
                                aria-label={t("notifications.bell_unread", { count: badge })}
                                className="top-2! right-2 rounded-full bg-primary px-1.5 text-primary-foreground peer-data-active/menu-button:text-primary-foreground peer-hover/menu-button:text-primary-foreground [[data-mobile=true]_&]:top-3!"
                              >
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
              {id === "lead" ? (
                <SidebarPins wsId={workspace.id} ws={ws} pathname={pathname} onNavigate={dismissSheet} />
              ) : null}
              </Fragment>
            ),
          )}
        </nav>
      </SidebarContent>

      <SidebarFooter className="px-2 pt-1 pb-2 group-data-[collapsible=icon]:px-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    // Starts with what the button shows, so a voice-control
                    // user can say the name they see (WCAG 2.5.3).
                    aria-label={t("nav.account_named", { name: user.display_name, email: user.email })}
                    tooltip={user.display_name}
                    className="gap-2.5 px-2"
                  />
                }
              >
                <ActorAvatar
                  name={user.display_name}
                  initials={initialOf(user.display_name)}
                  avatarUrl={user.avatar_url}
                  size="lg"
                  className="bg-sidebar-accent text-sidebar-accent-foreground"
                />
                <span className="flex min-w-0 flex-1 flex-col text-left group-data-[collapsible=icon]:hidden">
                  <span title={user.display_name} className="truncate text-body font-semibold text-foreground">
                    {user.display_name}
                  </span>
                  <span title={user.email} className="truncate text-caption text-muted-foreground">
                    {user.email}
                  </span>
                </span>
                <ChevronDown aria-hidden className="ml-auto size-3! text-muted-foreground group-data-[collapsible=icon]:hidden" />
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
