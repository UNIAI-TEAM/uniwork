"use client";

import {
  ChevronDown,
  CircleX,
  Compass,
  Hash,
  ListChecks,
  MessagesSquare,
  PanelLeftClose,
  Search,
  SquarePen,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
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

/* Menu rows at the canvas' 44px: 14px label, 18px muted icon 12px before it. */
const MENU_ITEM =
  "h-11 gap-3 rounded-control px-2.5 text-body font-medium [&_svg]:size-4.5 [&_svg]:text-muted-foreground";
const MENU = "w-63 rounded-[14px] p-1.5";

const noopSubscribe = () => () => {};

/**
 * The list's head (canvas "Main"): the organization as a small caption, the
 * workspace name under it, and the one way to start a conversation. The name
 * opens the list's own options — follow-ups, the channel directory, hiding the
 * list — which the canvas leaves no other place for.
 */
export function SidebarHeader({
  onOpenFollowUps,
  onOpenFollowedThreads,
  onCollapse,
  onStartDm,
  onCreateGroup,
  onCreateChannel,
  onBrowseChannels,
}: {
  onOpenFollowUps?: () => void;
  onOpenFollowedThreads?: () => void;
  onCollapse?: () => void;
  onStartDm: () => void;
  /** Absent while groups cannot be created here: the item shows, disabled. */
  onCreateGroup?: () => void;
  onCreateChannel: () => void;
  onBrowseChannels: () => void;
}) {
  const { t } = useTranslation();
  const workspace = useOptionalWorkspace()?.workspace;
  const name = workspace?.name ?? t("chat.title");
  return (
    <header className="flex shrink-0 items-center gap-2 pt-3.5 pr-4 pb-3 pl-5">
      {/* The page's h1 names the screen; this keeps the list a titled section. */}
      <h2 id="chat-sidebar-title" className="sr-only">
        {t("chat.title")}
      </h2>
      <DropdownMenu>
        <DropdownMenuTrigger
          // Showing the list again lands focus here (use-chat-page-panels).
          data-chat-sidebar-collapse=""
          aria-label={t("chat.sidebar_list_menu_aria", { name })}
          className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left"
        >
          {workspace?.organization_name ? (
            <span className="max-w-full truncate text-caption font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              {workspace.organization_name}
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
          {onOpenFollowedThreads ? (
            <DropdownMenuItem className={MENU_ITEM} onClick={onOpenFollowedThreads}>
              <MessagesSquare aria-hidden />
              {t("chat.followed_threads.list_title")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className={MENU_ITEM} onClick={onBrowseChannels}>
            <Compass aria-hidden />
            {t("chat.channel.directory_aria")}
          </DropdownMenuItem>
          {onCollapse ? (
            <DropdownMenuItem className={`${MENU_ITEM} hidden lg:flex`} onClick={onCollapse}>
              <PanelLeftClose aria-hidden />
              {t("chat.hide_conversations")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    // The canvas' filled 44px square: the one way to start a
                    // conversation stands apart from everything around it.
                    className="size-11 rounded-lg bg-muted text-foreground hover:bg-surface-hover aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground aria-expanded:ring-[1.5px] aria-expanded:ring-brand/25 aria-expanded:ring-inset dark:hover:bg-surface-hover"
                    aria-label={t("chat.new_conversation_aria")}
                  />
                }
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
          <DropdownMenuSeparator className="mx-1 my-1.5" />
          <DropdownMenuItem className={MENU_ITEM} onClick={onCreateChannel}>
            <Hash aria-hidden />
            {t("chat.channel.create_aria")}
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM} onClick={onBrowseChannels}>
            <Compass aria-hidden />
            {t("chat.channel.directory_aria")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

/**
 * The search pill. Inside UniChat the global search chord (⌘K) focuses it and
 * the pill shows the chord; on web that chord stays the command palette's, so
 * the pill shows none.
 */
export function SidebarSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
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
          placeholder={t("chat.search_conversations")}
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
