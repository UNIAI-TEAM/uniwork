"use client";

import {
  Building2,
  ChevronDown,
  CircleX,
  Compass,
  Hash,
  ListChecks,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Search,
  SquarePen,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useChatUnreadSummary } from "@uniwork/core/chat";
import { paths } from "@uniwork/core/paths";
import { getDesktopBridge } from "@uniwork/core/platform";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import {
  formatShortcut,
  isPortalLayerShortcutTarget,
  shortcutMatchesEvent,
  shouldIgnoreGlobalShortcutEvent,
  useShortcut,
} from "@uniwork/core/shortcuts";
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
import { Input } from "@uniwork/ui/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { WorkspaceIcon } from "../layout/workspace-icon";
import { initialsOf, workspaceTint } from "../layout/workspace-rail";
import { AppLink } from "../navigation";
import type { ChatScope } from "./chat-scope";

/* Menu rows at the canvas' 44px: 14px label, 18px muted icon 12px before it. */
const MENU_ITEM =
  "h-11 gap-3 rounded-control px-2.5 text-body font-medium [&_svg]:size-4.5 [&_svg]:text-muted-foreground";
const MENU = "w-63 rounded-[14px] p-1.5";
/* The canvas' filled 44px square: the one way to start something stands apart from everything around it. */
const COMPOSE =
  "size-11 shrink-0 rounded-lg bg-muted text-foreground hover:bg-surface-hover aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground aria-expanded:ring-[1.5px] aria-expanded:ring-brand/25 aria-expanded:ring-inset dark:hover:bg-surface-hover";

const noopSubscribe = () => () => {};

/**
 * The list's head (canvas "Tin nhắn" / "Workspace"): where the reader is, as
 * a caption, a title and one line on what the list holds, then the one way to
 * start something there. Messages are the organization's DMs and groups, so
 * "+" starts one of those; a workspace holds channels, so "+" makes a channel
 * in it. The title opens the list's own options: follow-ups, the channel
 * directory, hiding the list.
 */
export function SidebarHeader({
  scope,
  onOpenFollowUps,
  onCollapse,
  onStartDm,
  onCreateGroup,
  onCreateChannel,
  onBrowseChannels,
}: {
  scope: ChatScope;
  onOpenFollowUps?: () => void;
  onCollapse?: () => void;
  onStartDm: () => void;
  /** Absent while groups cannot be created here: the item shows, disabled. */
  onCreateGroup?: () => void;
  onCreateChannel: () => void;
  onBrowseChannels: () => void;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const { data: workspaces = [] } = useWorkspaces();
  const messages = scope === "messages";
  const name = messages ? t("chat.scope.messages_title") : (workspace?.name ?? t("chat.title"));
  return (
    <header data-window-drag className="flex shrink-0 items-start gap-2 pt-3.5 pr-4 pb-3 pl-5">
      {/* The page's h1 names the screen; this keeps the list a titled section. */}
      <h2 id="chat-sidebar-title" className="sr-only">
        {name}
      </h2>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <DropdownMenu>
          <DropdownMenuTrigger
            // Showing the list again lands focus here (use-chat-page-panels).
            data-chat-sidebar-collapse=""
            aria-label={t("chat.sidebar_list_menu_aria", { name })}
            className="flex max-w-full min-w-0 flex-col items-start rounded-md text-left"
          >
            {workspace?.organization_name ? (
              <span className="flex max-w-full items-center gap-1.5 text-caption font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                {messages ? null : (
                  <WorkspaceIcon
                    workspace={workspace}
                    fallback={initialsOf(workspace.name)}
                    className={cn(
                      "size-4.5 shrink-0 rounded-[5px] text-micro font-bold tracking-normal",
                      tintSolidClass[workspaceTint(workspaces, workspace.id)],
                    )}
                  />
                )}
                <span className="truncate">
                  {messages
                    ? workspace.organization_name
                    : t("chat.scope.workspace_overline", { org: workspace.organization_name })}
                </span>
              </span>
            ) : null}
            <span className="flex max-w-full min-w-0 items-center gap-1 text-title-xl font-extrabold text-foreground">
              <span className="truncate">{name}</span>
              <ChevronDown aria-hidden strokeWidth={2.2} className="size-4.5 shrink-0 text-muted-foreground" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={MENU}>
            {onOpenFollowUps ? (
              <DropdownMenuItem className={MENU_ITEM} onClick={onOpenFollowUps}>
                <ListChecks aria-hidden />
                {t("chat.follow_up.list_title")}
              </DropdownMenuItem>
            ) : null}
            {messages ? null : (
              <DropdownMenuItem className={MENU_ITEM} onClick={onBrowseChannels}>
                <Compass aria-hidden />
                {t("chat.channel.directory_aria")}
              </DropdownMenuItem>
            )}
            {onCollapse ? (
              <DropdownMenuItem className={`${MENU_ITEM} hidden lg:flex`} onClick={onCollapse}>
                <PanelLeftClose aria-hidden />
                {t("chat.hide_conversations")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="mt-1 flex max-w-full items-center gap-1.5 text-caption text-muted-foreground">
          {messages ? <Building2 aria-hidden className="size-3.5 shrink-0" /> : <Hash aria-hidden className="size-3.5 shrink-0" />}
          <span className="truncate">{messages ? t("chat.scope.messages_hint") : t("chat.scope.channels_hint")}</span>
        </p>
      </div>
      {messages ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button type="button" variant="ghost" size="icon-lg" className={COMPOSE} aria-label={t("chat.new_conversation_aria")} />}
                />
              }
            >
              <SquarePen aria-hidden className="size-5" />
            </TooltipTrigger>
            <TooltipContent>{t("chat.new_conversation_aria")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className={MENU}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2.5 pt-2 pb-1.5 text-caption font-semibold text-muted-foreground">
                {t("chat.new_conversation_aria")}
              </DropdownMenuLabel>
              <DropdownMenuItem className={MENU_ITEM} onClick={onStartDm}>
                <UserPlus aria-hidden />
                {t("chat.add_dm_aria")}
              </DropdownMenuItem>
              <DropdownMenuItem className={MENU_ITEM} disabled={!onCreateGroup} onClick={onCreateGroup}>
                <Users aria-hidden />
                {t("chat.create_group_aria")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className={COMPOSE}
                aria-label={t("chat.scope.create_channel_in", { name })}
                onClick={onCreateChannel}
              />
            }
          >
            <Plus aria-hidden className="size-5" />
          </TooltipTrigger>
          <TooltipContent>{t("chat.scope.create_channel_in", { name })}</TooltipContent>
        </Tooltip>
      )}
    </header>
  );
}

/**
 * Where there is no UniChat rail (the web app, a phone): "Tin nhắn | Kênh"
 * above the list, each with its unread, the canvas' mobile switch. Each side
 * is the same link the rail would follow.
 */
export function ChatScopeSwitch({ scope }: { scope: ChatScope }) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const desktop = useSyncExternalStore(noopSubscribe, () => getDesktopBridge() !== null, () => false);
  const summary = useChatUnreadSummary().data;
  const { data: workspaces = [] } = useWorkspaces();
  if (desktop || !workspace) return null;
  const at = paths.workspace(workspace.organization_slug, workspace.slug);
  const channels = summary?.workspaces.find((row) => row.workspace_id === workspace.id);
  const sides = [
    { scope: "messages" as const, href: at.chatMessages(), label: t("chat.scope.messages_title"), totals: summary?.direct },
    { scope: "workspace" as const, href: at.chatChannels(), label: t("chat.scope.channels_tab"), totals: channels },
  ];
  return (
    <nav aria-label={t("chat.scope.switch_aria")} className="shrink-0 px-4 pt-3">
      <div className="flex gap-1 rounded-[14px] bg-muted p-1">
        {sides.map((side) => {
          const on = side.scope === scope;
          const unread = side.totals?.unread ?? 0;
          return (
            <AppLink
              key={side.scope}
              href={side.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[11px] text-body font-medium text-muted-foreground transition-colors",
                on && "bg-surface font-semibold text-foreground shadow-sm",
              )}
            >
              {side.scope === "messages" ? (
                <MessagesSquare aria-hidden className="size-4.5 shrink-0 text-brand" />
              ) : (
                <WorkspaceIcon
                  workspace={workspace}
                  fallback={initialsOf(workspace.name)}
                  className={cn("size-4.5 shrink-0 rounded-[5px] text-micro font-bold", tintSolidClass[workspaceTint(workspaces, workspace.id)])}
                />
              )}
              <span className="truncate">{side.label}</span>
              {unread > 0 ? (
                <span
                  className={cn(
                    "h-5 min-w-5 rounded-full px-1.5 text-center text-caption leading-5 font-bold text-on-solid tabular-nums",
                    (side.totals?.mentions ?? 0) > 0 ? "bg-destructive-solid" : "bg-brand",
                  )}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </AppLink>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The search pill. Inside UniChat the global search chord (⌘K) focuses it and
 * the pill shows the chord; on web that chord stays the command palette's, so
 * the pill shows none.
 */
export function SidebarSearch({
  scope,
  value,
  onChange,
}: {
  scope: ChatScope;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const workspaceName = useOptionalWorkspace()?.workspace.name;
  const inputRef = useRef<HTMLInputElement>(null);
  const desktop = useSyncExternalStore(noopSubscribe, () => getDesktopBridge() !== null, () => false);
  const chord = useShortcut("openSearch");

  useEffect(() => {
    if (!desktop || !chord) return;
    // Capture phase: it runs before the global listener, which then sees the
    // chord as handled. A popup that owns the keys keeps them.
    const onKeyDown = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input?.offsetParent || shouldIgnoreGlobalShortcutEvent(event)) return;
      if (isPortalLayerShortcutTarget(event.target) || !shortcutMatchesEvent(chord, event)) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [desktop, chord]);

  return (
    <div className="shrink-0 px-4 pb-2.5">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            scope === "workspace" && workspaceName
              ? t("chat.scope.search_channels", { name: workspaceName })
              : t("chat.search_conversations")
          }
          aria-label={t("chat.search_conversations_label")}
          type="search"
          autoComplete="off"
          className={cn(
            "h-11 rounded-full border-transparent bg-muted pl-10.5 hover:bg-surface-hover focus-visible:bg-surface md:text-body-lg dark:bg-muted dark:focus-visible:bg-surface",
            value || (desktop && chord) ? "pr-12" : "pr-4",
            // The pill draws its own clear button.
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
        {value ? (
          <button
            type="button"
            aria-label={t("chat.clear_search")}
            className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          >
            <CircleX aria-hidden className="size-5 fill-muted-foreground text-surface" />
          </button>
        ) : desktop && chord ? (
          <kbd className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 rounded-sm border border-border px-1.5 font-sans text-caption text-muted-foreground">
            {formatShortcut(chord)}
          </kbd>
        ) : null}
      </div>
    </div>
  );
}
