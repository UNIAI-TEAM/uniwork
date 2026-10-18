"use client";

import type { ReactElement, ReactNode } from "react";
import { LogOut, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { useChatUnreadSummary } from "@uniwork/core/chat";
import { useUnreadCount } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintSolidClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { useWorkspace } from "./workspace-context";
import { WorkspaceIcon } from "./workspace-icon";
import { usePreferenceMenuItems } from "./workspace-top-bar";

/**
 * Rail tiles take their colour from the workspace's place in the member's list
 * (oldest first, as the server orders it), like departments do: with a handful
 * of workspaces a hash lands two on one colour, and then the colour says nothing.
 */
const RAIL_TINTS: readonly Tint[] = ["blue", "orange", "violet", "green", "pink", "teal", "yellow"];

export function workspaceTint(workspaces: readonly Pick<Workspace, "id">[], id: string): Tint {
  const index = Math.max(0, workspaces.findIndex((w) => w.id === id));
  return RAIL_TINTS[index % RAIL_TINTS.length]!;
}

/** First letters of the first two words: "Truyền thông" → "TT". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0]!.toUpperCase()).join("") || "?";
}

function RailTooltip({ label, trigger, children }: { label: string; trigger: ReactElement; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The UniChat shell's left column: one tile per workspace, the current one
 * ringed and barred, another's chat unread as a pill (red when it mentions the
 * reader) and any news as a short bar; settings and the account at the foot.
 * Switching is the same in-app push as the switcher's.
 */
export function WorkspaceRail() {
  const { t } = useTranslation();
  const { workspace: current } = useWorkspace();
  const { push } = useNavigation();
  const { data: workspaces = [] } = useWorkspaces();
  const notifications = useUnreadCount().data?.by_workspace;
  const chat = useChatUnreadSummary().data?.workspaces;
  // The list loads after the shell; the current workspace holds its place until then.
  const tiles = workspaces.some((w) => w.id === current.id) ? workspaces : [current, ...workspaces];

  return (
    <nav
      aria-label={t("nav.workspaces_rail")}
      className="flex h-svh w-[72px] shrink-0 flex-col items-center gap-3 border-r border-chat-rail-border bg-chat-rail pt-2.5 pb-4"
    >
      {/* Padded so the ring and the pills of the first tile are not clipped by the scroll box. */}
      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto pt-1.5 pb-1 [scrollbar-width:none]">
        {tiles.map((w) => {
          const on = w.id === current.id;
          const unread = chat?.find((c) => c.workspace_id === w.id);
          const count = on ? 0 : (unread?.unread ?? 0);
          const mentions = on ? 0 : (unread?.mentions ?? 0);
          const news = count > 0 || (!on && (notifications?.[w.id] ?? 0) > 0);
          const label = [
            w.name,
            count > 0 ? t("chat.unread_badge_aria", { count }) : null,
            mentions > 0 ? t("chat.mention_unread_badge_aria", { count: mentions }) : null,
            !count && news ? t("notifications.unread_elsewhere") : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={w.id} className="relative flex w-full shrink-0 justify-center">
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 w-1 rounded-r-sm bg-foreground transition-all",
                  on ? "top-1.5 h-9" : news ? "top-5 h-2" : "top-5 h-0",
                )}
              />
              <RailTooltip
                label={w.name}
                trigger={
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={on ? "page" : undefined}
                    onClick={() => {
                      if (!on) push(paths.workspace(w.organization_slug, w.slug).chat());
                    }}
                    className={cn(
                      "relative size-12 rounded-xl font-display text-body-lg font-bold",
                      tintSolidClass[workspaceTint(tiles, w.id)],
                      on && "ring-2 ring-primary ring-offset-2 ring-offset-chat-rail",
                    )}
                  />
                }
              >
                <WorkspaceIcon workspace={w} fallback={initialsOf(w.name)} className="size-full rounded-xl" />
                {count > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -top-1.5 -right-2 h-[22px] min-w-[22px] rounded-full border-2 border-chat-rail px-[5px] text-center text-micro leading-[18px] font-bold tabular-nums",
                      mentions > 0 ? "bg-destructive-solid text-on-solid" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </RailTooltip>
            </li>
          );
        })}
      </ul>
      <RailSettingsMenu />
      <RailAccountMenu />
    </nav>
  );
}

const railButtonClass =
  "flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 data-popup-open:bg-foreground/5";

/** Settings, theme and language: what the web shell keeps on its top bar. */
function RailSettingsMenu() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { themeItems, languageItems } = usePreferenceMenuItems();
  const label = t("nav.settings");
  return (
    <DropdownMenu>
      <RailTooltip
        label={label}
        trigger={<DropdownMenuTrigger render={<button type="button" aria-label={label} className={railButtonClass} />} />}
      >
        <Settings aria-hidden className="size-[21px]" />
      </RailTooltip>
      <DropdownMenuContent side="right" align="end" className="min-w-56">
        <DropdownMenuItem render={<AppLink href={paths.workspace(workspace.organization_slug, workspace.slug).settings()} />}>
          <Settings aria-hidden />
          {label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {themeItems(t("topbar.theme"))}
        <DropdownMenuSeparator />
        {languageItems(t("topbar.language"))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Who is signed in, a new workspace, and sign out: the web sidebar's account menu. */
function RailAccountMenu() {
  const { t } = useTranslation();
  const { user } = useWorkspace();
  const { push, replace } = useNavigation();
  const { mutateAsync: logout } = useLogout();
  return (
    <DropdownMenu>
      <RailTooltip
        label={user.display_name}
        trigger={
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={t("nav.account_named", { name: user.display_name, email: user.email })}
                className="flex size-11 items-center justify-center rounded-full"
              />
            }
          />
        }
      >
        <ActorAvatar
          name={user.display_name}
          initials={initialsOf(user.display_name)}
          avatarUrl={user.avatar_url}
          size="fluid"
          className="size-9 bg-primary font-display text-caption font-bold text-primary-foreground"
        />
      </RailTooltip>
      <DropdownMenuContent side="right" align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium text-foreground">{user.display_name}</span>
            <span className="truncate font-normal text-caption text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => push(paths.newWorkspace())}>
            <Plus aria-hidden />
            {t("workspace.new")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
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
