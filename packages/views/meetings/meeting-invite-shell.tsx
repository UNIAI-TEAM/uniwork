"use client";

import type { ReactNode } from "react";
import { Logo } from "@uniwork/ui/brand";
import { cn } from "@uniwork/ui/lib/utils";
import { LocaleSwitch } from "../auth/locale-switch";

export function MeetingInviteShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
        <Logo variant="lockup" size={26} />
        <LocaleSwitch className="-mr-2" />
      </header>
      <main
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col justify-center px-4 pb-10 pt-2 sm:px-6 sm:pb-12",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}

export function MeetingInviteStateCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <MeetingInviteShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-surface-border bg-surface p-6 shadow-[var(--floating-shadow)] sm:p-8">
        <h1 className="text-balance text-display-sm font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-pretty text-body text-muted-foreground">{description}</p> : null}
        {children}
      </div>
    </MeetingInviteShell>
  );
}
