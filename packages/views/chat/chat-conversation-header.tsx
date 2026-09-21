"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Disc3,
  History,
  Info,
  MoreHorizontal,
  PanelLeft,
  Phone,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";

/** One icon action in the header: a named button with the same name as a tooltip. */
function HeaderAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
  expanded,
}: {
  icon: LucideIcon;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  expanded?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("text-muted-foreground hover:text-foreground", className)}
            aria-label={label}
            aria-expanded={expanded}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <Icon className="size-[18px]" aria-hidden />
      </TooltipTrigger>
      {label ? <TooltipContent>{label}</TooltipContent> : null}
    </Tooltip>
  );
}

export function ChatConversationHeader({
  avatar,
  title,
  subtitle,
  backAriaLabel,
  onBack,
  sidebarCollapsed,
  sidebarToggleAriaLabel,
  onToggleSidebar,
  settingsAriaLabel,
  onOpenSettings,
  catchUpAriaLabel,
  onCatchUp,
  catchUpDisabled,
  recordingsAriaLabel,
  onOpenRecordings,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
  videoCallAriaLabel,
  onVideoCall,
  videoCallDisabled,
  className,
}: {
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  backAriaLabel?: string;
  onBack?: () => void;
  sidebarCollapsed?: boolean;
  sidebarToggleAriaLabel?: string;
  onToggleSidebar?: () => void;
  settingsAriaLabel?: string;
  onOpenSettings?: () => void;
  catchUpAriaLabel?: string;
  onCatchUp?: () => void;
  catchUpDisabled?: boolean;
  recordingsAriaLabel?: string;
  onOpenRecordings?: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  videoCallAriaLabel?: string;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const hasSecondary = Boolean(onCatchUp || onOpenRecordings);
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3 sm:px-4",
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
        />
      ) : null}
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-body-lg leading-tight font-semibold text-foreground">{title}</h1>
        {subtitle ? (
          <p className="truncate text-caption leading-tight text-muted-foreground tabular-nums">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Secondary actions stand in the row from sm; on a phone they fold
            into one "more" menu so the title keeps its width. */}
        {onCatchUp ? (
          <HeaderAction
            icon={History}
            label={catchUpAriaLabel}
            disabled={catchUpDisabled}
            onClick={onCatchUp}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {onOpenRecordings ? (
          <HeaderAction
            icon={Disc3}
            label={recordingsAriaLabel}
            onClick={onOpenRecordings}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {onVideoCall ? (
          <HeaderAction icon={Video} label={videoCallAriaLabel} disabled={videoCallDisabled} onClick={onVideoCall} />
        ) : null}
        {onVoiceCall ? (
          <HeaderAction icon={Phone} label={voiceCallAriaLabel} disabled={voiceCallDisabled} onClick={onVoiceCall} />
        ) : null}
        {hasSecondary ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="text-muted-foreground hover:text-foreground sm:hidden"
                  aria-label={t("chat.header_more_aria")}
                />
              }
            >
              <MoreHorizontal className="size-[18px]" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {onCatchUp ? (
                <DropdownMenuItem disabled={catchUpDisabled} onClick={onCatchUp}>
                  <History aria-hidden />
                  {catchUpAriaLabel}
                </DropdownMenuItem>
              ) : null}
              {onOpenRecordings ? (
                <DropdownMenuItem onClick={onOpenRecordings}>
                  <Disc3 aria-hidden />
                  {recordingsAriaLabel}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onOpenSettings ? (
          <HeaderAction icon={Info} label={settingsAriaLabel} onClick={onOpenSettings} />
        ) : null}
      </div>
    </header>
  );
}
