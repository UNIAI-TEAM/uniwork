"use client";

import { ChevronDown, LogOut, Settings, Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { AppLink, useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";

/** First letter of the first word, which is all an avatar has room for at 32px. */
function initialOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/**
 * The account menu (settings, the trash, log out). On a desktop shell it is the avatar at
 * the top bar's end, as in ClickUp; in the phone sheet it stays the sidebar's
 * footer row with the name and email.
 */
export function AccountMenu({ placement, onNavigate }: { placement: "sidebar" | "header"; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const { replace } = useNavigation();
  const { mutateAsync: logout } = useLogout();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  // Starts with what the button shows, so a voice-control user can say the name they see (WCAG 2.5.3).
  const label = t("nav.account_named", { name: user.display_name, email: user.email });
  const avatar = (size: "lg", className?: string) => (
    <ActorAvatar
      name={user.display_name}
      initials={initialOf(user.display_name)}
      avatarUrl={user.avatar_url}
      size={size}
      className={className}
    />
  );

  return (
    <DropdownMenu>
      {placement === "header" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="ghost" className="h-9 gap-1 rounded-full pr-1.5 pl-0.5 text-muted-foreground" aria-label={label} />
                }
              />
            }
          >
            {/* The initials' muted fill is the app plane's grey: give the circle the card surface and an edge. */}
            {avatar("lg", "bg-page-canvas text-foreground ring-1 ring-border")}
            {/* Says there is a menu behind the picture. */}
            <ChevronDown aria-hidden data-slot="account-chevron" className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{user.display_name}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger
          render={<SidebarMenuButton size="lg" aria-label={label} tooltip={user.display_name} className="gap-2.5 px-2" />}
        >
          {avatar("lg", "bg-sidebar-accent text-sidebar-accent-foreground")}
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
      )}
      <DropdownMenuContent
        align={placement === "header" ? "end" : "start"}
        side={placement === "header" ? "bottom" : "top"}
        className="min-w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium text-foreground">{user.display_name}</span>
            <span className="truncate font-normal text-caption text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<AppLink href={ws.settings()} onClick={onNavigate} />}>
            <Settings aria-hidden />
            {t("nav.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<AppLink href={`${ws.settings()}?tab=trash`} onClick={onNavigate} />}>
            <Trash aria-hidden />
            {t("nav.trash")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              onNavigate?.();
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
  );
}
