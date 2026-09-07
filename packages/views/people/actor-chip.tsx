"use client";

import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Actor } from "@uniwork/core/types/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * One actor, drawn the same way everywhere: avatar and name for a person, a
 * bot mark and an explicit label for an agent (ADR 0007). The badge comes from
 * `kind`, never from the name — an agent called "An" must not read as a
 * colleague.
 */
export function ActorChip({ actor, className }: { actor: Actor; className?: string }) {
  const { t } = useTranslation();
  const isAgent = actor.kind === "agent";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {isAgent ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot aria-hidden="true" className="size-3" />
        </span>
      ) : (
        <Avatar className="size-5 shrink-0">
          {actor.avatar_url ? <AvatarImage src={actor.avatar_url} alt="" /> : null}
          <AvatarFallback className="text-caption">{initials(actor.display_name)}</AvatarFallback>
        </Avatar>
      )}
      <span className="truncate text-body">{actor.display_name}</span>
      {isAgent ? (
        <span className="shrink-0 text-caption text-muted-foreground">{t("people.agent_badge")}</span>
      ) : null}
    </span>
  );
}

/** Up to two letters from the name, for the avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
