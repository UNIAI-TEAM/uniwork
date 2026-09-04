"use client";

import type { ReactNode } from "react";
import { Phone, Settings } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export function ChatConversationHeader({
  avatar,
  title,
  subtitle,
  settingsAriaLabel,
  onOpenSettings,
  voiceCallAriaLabel,
  onVoiceCall,
  voiceCallDisabled,
  className,
}: {
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  settingsAriaLabel?: string;
  onOpenSettings?: () => void;
  voiceCallAriaLabel?: string;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3",
        className,
      )}
    >
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{title}</p>
        {subtitle ? (
          <p className="truncate text-caption text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
