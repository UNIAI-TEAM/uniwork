"use client";

import type { ReactNode } from "react";
import { ChevronLeft, PanelLeft, PanelLeftClose, Phone, Search, Settings, Video } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

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
  searchAriaLabel,
  onOpenSearch,
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
  searchAriaLabel?: string;
  onOpenSearch?: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  videoCallAriaLabel?: string;
  onVideoCall?: () => void;
  videoCallDisabled?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3",
        className,
      )}
    >
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          aria-label={backAriaLabel}
          onClick={onBack}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
      ) : null}
      {/* Narrow screens swap list and thread with the back control above, so
          the collapse toggle is a desktop-only affordance. */}
      {onToggleSidebar ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden size-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex"
          aria-label={sidebarToggleAriaLabel}
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="size-5" aria-hidden />
          ) : (
            <PanelLeftClose className="size-5" aria-hidden />
          )}
        </Button>
      ) : null}
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{title}</p>
        {subtitle ? (
          <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpenSearch ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={searchAriaLabel}
            onClick={onOpenSearch}
          >
            <Search className="size-5" aria-hidden />
          </Button>
        ) : null}
        {onVideoCall ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={videoCallAriaLabel}
            disabled={videoCallDisabled}
            onClick={onVideoCall}
          >
            <Video className="size-5" aria-hidden />
          </Button>
        ) : null}
        {onVoiceCall ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={voiceCallAriaLabel}
            disabled={voiceCallDisabled}
            onClick={onVoiceCall}
          >
            <Phone className="size-5" aria-hidden />
          </Button>
        ) : null}
        {onOpenSettings ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={settingsAriaLabel}
            onClick={onOpenSettings}
          >
            <Settings className="size-5" aria-hidden />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
