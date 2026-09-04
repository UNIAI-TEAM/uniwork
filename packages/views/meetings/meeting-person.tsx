"use client";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";

/** "Nguyễn Văn An" → "NA"; a bare id or email → its first letter. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

/** Initials avatar for a person in a meeting (no photos exist yet). */
export function MeetingPersonAvatar({
  name,
  size = "sm",
  className,
}: {
  name: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn("shrink-0", className)} aria-hidden>
      <AvatarFallback className="font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
