"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { LogOut, MessagesSquare, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogout } from "@uniwork/core/auth";
import { useChatRooms, useChatUnreadSummary } from "@uniwork/core/chat";
import { useUnreadCount } from "@uniwork/core/notifications";
import { paths } from "@uniwork/core/paths";
import { defaultStorage } from "@uniwork/core/platform";
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
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { CHAT_VIEW_PARAM, chatScopeOf } from "../chat/chat-scope";
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
 * The UniChat shell's left column. First the Tin nhắn tile: DMs and groups
 * belong to the organization, so they live once, here, above a rule; then one
 * tile per workspace, which holds its channels. The open one is ringed and
 * barred; the others carry their chat unread as a pill (red when it mentions
 * the reader), counted apart the way the server counts it, and any news as a
 * short bar. Settings and the account sit at the foot. Switching is the same
 * in-app push as the switcher's.
 */
export function WorkspaceRail() {
  const { t } = useTranslation();
  const { workspace: current } = useWorkspace();
  const { push, pathname, searchParams } = useNavigation();
  const { data: workspaces = [] } = useWorkspaces();
  const notifications = useUnreadCount().data?.by_workspace;
  const summary = useChatUnreadSummary().data;
  const chat = summary?.workspaces;
  const here = paths.workspace(current.organization_slug, current.slug);
  const roomParam = searchParams.get("room");
  const roomKind = useChatRooms(current.id).data?.find((room) => room.id === roomParam)?.kind;
  const messagesOpen =
    pathname === here.chat() && chatScopeOf(searchParams.get(CHAT_VIEW_PARAM), roomKind) === "messages";
  // The list loads after the shell; the current workspace holds its place until then.
  const tiles = workspaces.some((w) => w.id === current.id) ? workspaces : [current, ...workspaces];

  return (
    <nav
      aria-label={t("nav.workspaces_rail")}
      className="flex h-svh w-[72px] shrink-0 flex-col items-center gap-3 border-r border-chat-rail-border bg-chat-rail pt-2.5 pb-4 in-data-[window-chrome=inset]:pt-0"
    >
      {/* macOS shell: the traffic lights sit here, and the strip moves the window. */}
      <div data-window-drag aria-hidden className="-mb-3 hidden h-11 w-full shrink-0 in-data-[window-chrome=inset]:block" />
      <RailMessagesTile
        open={messagesOpen}
        unread={summary?.direct.unread ?? 0}
        mentions={summary?.direct.mentions ?? 0}
        organizationName={current.organization_name}
        onOpen={() => push(here.chatMessages())}
      />
      <span aria-hidden className="h-0.5 w-7 shrink-0 rounded-full bg-chat-rail-border" />
      {/* Padded so the ring and the pills of the first tile are not clipped by the scroll box. */}
      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto pt-1.5 pb-1 [scrollbar-width:none]">
        {tiles.map((w) => {
          const on = w.id === current.id && !messagesOpen;
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
                      if (on) return;
                      const at = paths.workspace(w.organization_slug, w.slug);
                      push(w.id === current.id ? at.chatChannels() : at.chat());
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

const MESSAGES_INTRO_KEY = "uniwork_chat_messages_intro_seen";

function introSeen(): boolean {
  try {
    return defaultStorage.getItem(MESSAGES_INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * The Tin nhắn tile: white with the brand glyph, filled in the brand once
 * open, the DM and group unread as a pill. The first time, a card beside it
 * says what moved here, since every workspace used to list these itself.
 */
function RailMessagesTile({
  open,
  unread,
  mentions,
  organizationName,
  onOpen,
}: {
  open: boolean;
  unread: number;
  mentions: number;
  organizationName?: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [intro, setIntro] = useState(() => !introSeen());
  const dismissIntro = () => {
    try {
      defaultStorage.setItem(MESSAGES_INTRO_KEY, "1");
    } catch {
      // Storage refused: the card returns next launch, nothing worse.
    }
    setIntro(false);
  };
  const count = open ? 0 : unread;
  const label = [
    t("chat.scope.rail_label"),
    count > 0 ? t("chat.unread_badge_aria", { count }) : null,
    !open && mentions > 0 ? t("chat.mention_unread_badge_aria", { count: mentions }) : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="relative flex w-full shrink-0 justify-center pt-1.5">
      <span
        aria-hidden
        className={cn(
          "absolute left-0 w-1 rounded-r-sm bg-foreground transition-all",
          open ? "top-3 h-9" : count > 0 ? "top-6.5 h-2" : "top-6.5 h-0",
        )}
      />
      <RailTooltip
        label={t("chat.scope.rail_tooltip")}
        trigger={
          <button
            type="button"
            aria-label={label}
            aria-current={open ? "page" : undefined}
            onClick={() => {
              if (intro) dismissIntro();
              if (!open) onOpen();
            }}
            className={cn(
              "relative flex size-12 items-center justify-center rounded-xl",
              open
                ? "bg-brand text-brand-foreground ring-2 ring-primary ring-offset-2 ring-offset-chat-rail"
                : "border border-border bg-surface text-brand hover:bg-surface-hover",
            )}
          />
        }
      >
        <MessagesSquare aria-hidden className="size-6" />
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
      {intro ? (
        <div
          role="dialog"
          aria-labelledby="rail-messages-intro"
          className="absolute top-0 left-[68px] z-50 w-68 rounded-xl bg-foreground p-4 pb-3.5 text-background shadow-floating"
        >
          <span aria-hidden className="absolute top-6 -left-1.5 size-3 rotate-45 rounded-[2px] bg-foreground" />
          <h2 id="rail-messages-intro" className="font-display text-body-lg font-bold">
            {t("chat.scope.intro_title")}
          </h2>
          <p className="mt-1.5 text-label text-pretty opacity-85">
            {t("chat.scope.intro_body", { org: organizationName ?? "" })}
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" className="h-11 rounded-full px-4.5" onClick={dismissIntro}>
              {t("chat.scope.intro_dismiss")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
