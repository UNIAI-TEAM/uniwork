"use client";

import { Fragment, useId, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import { useChatUnreadBadge } from "@uniwork/core/chat";
import { useEmailHubUnreadCount } from "@uniwork/core/email-hub/hooks";
import { useUnreadCount } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import { useScrollFade } from "@uniwork/ui/hooks/use-scroll-fade";
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
  SidebarTrigger,
  useSidebar,
} from "@uniwork/ui/components/ui/sidebar";
import { UI_EASE_SETTLE, UI_MOTION_DURATION } from "@uniwork/ui/lib/motion";
import { AppLink, useNavigation } from "../navigation";
import { AccountMenu } from "./account-menu";
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

/**
 * Workspace navigation. On a desktop shell it is the left of three floating
 * cards under the top bar (ClickUp-style): its collapse toggle on top, then the
 * modules and pins; the workspace switcher and the account sit on the top bar.
 * On a compact shell it is a sheet that keeps both, since that bar has no room.
 * PRODUCT.md keeps the nav to built surfaces only.
 */
export function AppSidebar() {
  const { workspace } = useWorkspace();
  const { pathname } = useNavigation();
  const { isCompact, setOpenMobile } = useSidebar();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  const dismissSheet = () => {
    if (isCompact) setOpenMobile(false);
  };

  return (
    // The container is fixed to the viewport, so on desktop it starts under the 48px top bar.
    <Sidebar variant="floating" collapsible="icon" className="lg:top-12 lg:h-[calc(100svh-3rem)] lg:pt-0">
      {isCompact ? (
        <SidebarHeader className="gap-2 px-2 pt-2 pb-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <WorkspaceSwitcher current={workspace} onNavigate={dismissSheet} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
      ) : (
        <SidebarHeader className="items-start px-2 pt-2 pb-0 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <SidebarTrigger size="icon" className="text-muted-foreground" />
        </SidebarHeader>
      )}

      <ModuleNav ws={ws} pathname={pathname} onNavigate={dismissSheet} />

      {isCompact ? (
        <SidebarFooter className="px-2 pt-1 pb-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <AccountMenu placement="sidebar" onNavigate={dismissSheet} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
      <SidebarRail />
    </Sidebar>
  );
}

/** The module groups and pins between the switcher and the account menu. */
function ModuleNav({
  ws,
  pathname,
  onNavigate,
}: {
  ws: ReturnType<typeof paths.workspace>;
  pathname: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);
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

  return (
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
                              onClick={onNavigate}
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
              <SidebarPins wsId={workspace.id} ws={ws} pathname={pathname} onNavigate={onNavigate} />
            ) : null}
            </Fragment>
          ),
        )}
      </nav>
    </SidebarContent>
  );
}
