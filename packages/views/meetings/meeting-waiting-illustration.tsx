"use client";

import { cn } from "@uniwork/ui/lib/utils";

/**
 * Friendly waiting-room illustration — decorative only; screen readers get copy from lobby text.
 */
export function MeetingWaitingIllustration({
  variant = "approval",
  className,
}: {
  variant?: "approval" | "host";
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 320 220"
      className={cn("h-auto w-full max-w-xs text-foreground/90 sm:max-w-sm", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="160" cy="196" rx="96" ry="10" className="fill-muted/60" />
      <rect x="118" y="132" width="84" height="8" rx="4" className="fill-muted" />
      <rect x="108" y="140" width="12" height="44" rx="4" className="fill-muted" />
      <rect x="200" y="140" width="12" height="44" rx="4" className="fill-muted" />
      <circle cx="160" cy="88" r="28" className="fill-brand/15 stroke-brand/40" strokeWidth="2" />
      <path
        d="M146 96c4-8 12-12 20-10 10 2 16 12 14 22-1 6-6 11-12 12"
        className="stroke-foreground/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="152" cy="84" r="2.5" className="fill-foreground/70" />
      <circle cx="168" cy="84" r="2.5" className="fill-foreground/70" />
      <path
        d="M132 118c8 10 20 14 32 12 14-2 24-12 28-24"
        className="stroke-foreground/60"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="128" y="118" width="64" height="18" rx="9" className="fill-brand/20" />
      {variant === "approval" ? (
        <>
          <circle cx="248" cy="72" r="20" className="fill-success/15 stroke-success/50" strokeWidth="2" />
          <path
            d="M240 72l6 6 12-12"
            className="stroke-success"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M56 96c0-12 8-22 20-24"
            className="stroke-muted-foreground/40"
            strokeWidth="2"
            strokeDasharray="4 6"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <circle cx="248" cy="72" r="20" className="fill-warning/15 stroke-warning/50" strokeWidth="2" />
          <path
            d="M248 64v16M240 72h16"
            className="stroke-warning"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
