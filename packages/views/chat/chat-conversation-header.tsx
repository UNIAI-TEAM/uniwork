"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Ellipsis, PanelLeft, PanelRight, Phone, Search, Sparkles, Video, type LucideIcon } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";

/** 44px icon buttons with a 12px radius, as on the canvas header. */
const HEADER_ICON_BUTTON = "size-11 rounded-lg text-muted-foreground hover:text-foreground";

/** A header toggle that is on (panel shown, search open): the brand wash, as on the canvas. */
const PRESSED = "bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-subtle hover:text-brand-subtle-foreground";

/** One icon action in the header: a named button with the same name as a tooltip. */
function HeaderAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
  expanded,
  pressed,
  ...rest
}: {
  icon: LucideIcon;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
  pressed?: boolean;
  "data-chat-sidebar-expand"?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn(HEADER_ICON_BUTTON, className)}
            aria-label={label}
            aria-expanded={expanded}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            {...rest}
          />
        }
      >
        <Icon className="size-5" aria-hidden />
      </TooltipTrigger>
      {label ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
}

export function ChatConversationHeader({
  avatar,
  title,
  titleAddon,
  subtitle,
  typingLabel,
  backAriaLabel,
  onBack,
  sidebarCollapsed,
  sidebarToggleAriaLabel,
  onToggleSidebar,
  panelAriaLabel,
  panelOpen,
  onTogglePanel,
  catchUpAriaLabel,
  onCatchUp,
  catchUpDisabled,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
  videoCallAriaLabel,
  onVideoCall,
  videoCallDisabled,
  searchAriaLabel,
  onSearch,
  searchOpen,
  className,
}: {
  avatar: ReactNode;
  title: string;
  /** Beside the title: the room's workspace when it is not the one open. */
  titleAddon?: ReactNode;
  subtitle?: ReactNode;
  /** "Minh đang nhập…": leads the subtitle in the brand colour while someone types. */
  typingLabel?: string | null;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  sidebarToggleAriaLabel?: string;
  onToggleSidebar?: () => void;
  /** The room's info panel: the last action, pressed while the panel shows. */
  panelAriaLabel?: string;
  panelOpen?: boolean;
  onTogglePanel?: () => void;
  catchUpAriaLabel?: string;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  videoCallAriaLabel?: string;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
  /** Search this conversation: an icon from sm, a menu entry on a phone. */
  searchAriaLabel?: string;
  onSearch?: () => void;
  /** The search bar is open under the header: its button reads pressed. */
  searchOpen?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  // Below sm every action but the panel folds into one "more" menu — calls
  // included — so a 360px screen still gives the room name its width.
  const hasMenu = Boolean(onSearch || onCatchUp || onVideoCall || onVoiceCall);
  const typing = typingLabel?.trim();
  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface pr-2 pl-3 sm:pr-3 sm:pl-5",
        className,
      )}
    >
      {onBack ? (
        <HeaderAction icon={ChevronLeft} label={backAriaLabel} onClick={onBack} className="-ml-1 lg:hidden" />
      ) : null}
      {/* The list carries its own collapse control; once it is hidden, the
          way back lives here. Narrow screens swap list and thread with the
          back control above instead. */}
      {onToggleSidebar && sidebarCollapsed ? (
        <HeaderAction
          icon={PanelLeft}
          label={sidebarToggleAriaLabel}
          expanded={false}
          onClick={onToggleSidebar}
          className="hidden lg:inline-flex"
          data-chat-sidebar-expand=""
        />
      ) : null}
      {/* 32px on a phone, the full 42px mark from sm: the avatar yields width to the name. */}
      <div className="flex size-8 shrink-0 items-center justify-center *:shrink-0 max-sm:*:scale-80 sm:size-auto">
        {avatar}
      </div>
      <div className="min-w-0 flex-1">
        {/* The page's h1 is "Trò chuyện"; the open room is the section under it.
            Focus lands here when a conversation opens on a phone. */}
        <div className="flex min-w-0 items-center gap-2">
          <h2
            tabIndex={-1}
            data-chat-conversation-title=""
            title={title}
            className="truncate font-display text-title-sm font-bold text-foreground focus-visible:outline-offset-2"
          >
            {title}
          </h2>
          {titleAddon}
        </div>
        {typing || subtitle ? (
          <p className="truncate text-label text-muted-foreground tabular-nums">
            {typing ? <span className="font-medium text-primary">{typing}</span> : null}
            {typing && subtitle ? " · " : null}
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Secondary actions stand in the row from sm; on a phone they fold
            into one "more" menu so the title keeps its width. */}
        {onSearch ? (
          <HeaderAction
            icon={Search}
            label={searchAriaLabel}
            onClick={onSearch}
            pressed={searchOpen}
            className={cn("hidden sm:inline-flex", searchOpen && PRESSED)}
          />
        ) : null}
        {onCatchUp ? (
          <HeaderAction
            icon={Sparkles}
            label={catchUpAriaLabel}
            disabled={catchUpDisabled}
            onClick={onCatchUp}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {onVoiceCall ? (
          <HeaderAction
            icon={Phone}
            label={voiceCallAriaLabel}
            disabled={voiceCallDisabled}
            onClick={onVoiceCall}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {onVideoCall ? (
          <HeaderAction
            icon={Video}
            label={videoCallAriaLabel}
            disabled={videoCallDisabled}
            onClick={onVideoCall}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className={cn(HEADER_ICON_BUTTON, "sm:hidden")}
                  aria-label={t("chat.header_more_aria")}
                />
              }
            >
              <Ellipsis className="size-5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {onSearch ? (
                <DropdownMenuItem onClick={onSearch}>
                  <Search aria-hidden />
                  {searchAriaLabel}
                </DropdownMenuItem>
              ) : null}
              {onCatchUp ? (
                <DropdownMenuItem disabled={catchUpDisabled} onClick={onCatchUp}>
                  <Sparkles aria-hidden />
                  {catchUpAriaLabel}
                </DropdownMenuItem>
              ) : null}
              {onVoiceCall ? (
                <DropdownMenuItem disabled={voiceCallDisabled} onClick={onVoiceCall}>
                  <Phone aria-hidden />
                  {voiceCallAriaLabel}
                </DropdownMenuItem>
              ) : null}
              {onVideoCall ? (
                <DropdownMenuItem disabled={videoCallDisabled} onClick={onVideoCall}>
                  <Video aria-hidden />
                  {videoCallAriaLabel}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onTogglePanel ? (
          <HeaderAction
            icon={PanelRight}
            label={panelAriaLabel}
            pressed={Boolean(panelOpen)}
            onClick={onTogglePanel}
            className={cn(panelOpen && PRESSED)}
          />
        ) : null}
      </div>
    </header>
  );
}
