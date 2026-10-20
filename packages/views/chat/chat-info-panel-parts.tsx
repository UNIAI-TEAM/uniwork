"use client";

import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

/** One block of the info panel, cut from the next by the canvas's 8px band. */
export function ChatInfoSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  /** "Xem 7", "Xem tất cả", the pencil: sits at the end of the title row. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t-8 border-muted px-5 py-4", className)}>
      {title ? (
        <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
          <h3 className="text-label font-semibold text-muted-foreground">{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The brand-coloured text button at the end of a section title ("Xem 7"). */
export function ChatInfoLink({ children, onClick, expanded }: { children: ReactNode; onClick: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className="-my-2 -mr-2 inline-flex min-h-9 cursor-pointer items-center rounded-md px-2 text-label font-semibold text-primary hover:bg-surface-hover"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A square quick action under the hero: brand glyph over its label, on the muted tile. */
export function ChatInfoTile({
  icon: Icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** A real toggle (mute): reported as pressed and drawn in the brand wash. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-[14px] px-1 py-2.5 text-primary transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50",
        pressed ? "bg-brand-subtle" : "bg-muted hover:bg-surface-hover",
      )}
      onClick={onClick}
    >
      <Icon className="size-5" aria-hidden />
      <span className="max-w-full truncate text-caption font-semibold text-foreground">{label}</span>
    </button>
  );
}

/** A row in the panel's last block: icon, label, chevron to the sheet or list it opens. */
export function ChatInfoMoreRow({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex min-h-11 w-full cursor-pointer items-center gap-3.5 py-2 pr-4 pl-5 text-left text-body-lg text-foreground transition-colors duration-(--duration-fast) hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
    >
      <Icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" aria-hidden />
    </button>
  );
}
