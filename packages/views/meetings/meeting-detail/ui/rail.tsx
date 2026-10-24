"use client";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** A labelled group below a hairline (kit `.rail-group`); `nav` for the outline, named by its label. */
export function RailGroup({
  label,
  nav,
  children,
  className,
}: {
  label?: string;
  nav?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const Tag = nav ? "nav" : "div";
  return (
    <Tag aria-label={nav ? label : undefined} className={cn("mt-4 flex flex-col border-t border-border pt-4", className)}>
      {label ? <p className="mb-1.5 text-caption font-medium text-muted-foreground">{label}</p> : null}
      {children}
    </Tag>
  );
}

/** Keeps the chevron on the line of the value's last word, or of the whole value when it is one phrase ("Bản nháp", kit `.nw`). */
function WithChevron({ value }: { value: ReactNode }) {
  const chevron = <ChevronRight aria-hidden className="ml-1 inline-block size-3 -translate-y-px text-muted-foreground" />;
  if (typeof value !== "string") {
    return (
      <>
        {value}
        {chevron}
      </>
    );
  }
  const cut = value.includes(" · ") ? value.lastIndexOf(" ") : -1;
  return (
    <>
      {cut > 0 ? value.slice(0, cut + 1) : null}
      <span className="whitespace-nowrap">
        {value.slice(cut + 1)}
        {chevron}
      </span>
    </>
  );
}

const PROP_GRID =
  "grid min-h-8 grid-cols-[14px_70px_minmax(0,1fr)] items-start gap-x-2 py-1.5 text-left @max-[37.5rem]/meeting:grid-cols-[14px_84px_minmax(0,1fr)]";

/**
 * A rail property row (kit `.prop`): icon 14 · label 70 · value. With
 * `onClick` it is a button that opens something, bleeding 8px each side for
 * its hover fill, with a chevron after the value; `ariaLabel` then names the
 * whole row ("Người dự: 3/3 có mặt, xem điểm danh").
 */
export function RailProp({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
  ariaLabel,
  haspopup = "dialog",
  chevron = true,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  /** `false` for a row that acts in place (switches a tab) rather than opening something. */
  haspopup?: "dialog" | "menu" | "listbox" | false;
  /** `false` keeps a value that just fits the column on one line (live "Lời mời"); the hover fill still shows the row acts. */
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden className="mt-0.75 size-3.5 text-muted-foreground" />
      <span className="text-caption leading-5 text-muted-foreground">{label}</span>
      <span className="block min-w-0 text-body">
        {onClick && chevron ? <WithChevron value={value} /> : value}
        {sub ? <span className="mt-0.5 block text-caption text-muted-foreground">{sub}</span> : null}
      </span>
    </>
  );
  if (!onClick) return <div className={cn(PROP_GRID, className)}>{body}</div>;
  return (
    <button
      type="button"
      aria-haspopup={haspopup || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        PROP_GRID,
        "-mx-2 w-[calc(100%+16px)] rounded-md px-2 text-foreground hover:bg-surface-hover active:bg-muted",
        className,
      )}
    >
      {body}
    </button>
  );
}

/** "Lịch sử thao tác ›" (kit `.rail-link`): a body row that opens a drawer; `count` is the muted caption after the label. */
export function RailLink({
  children,
  count,
  onClick,
  className,
}: {
  children: ReactNode;
  count?: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      className={cn(
        "-mx-2 flex h-8 items-center rounded-md px-2 text-left text-body text-foreground hover:bg-surface-hover pointer-coarse:min-h-11",
        className,
      )}
    >
      {/* With a count, label and count sit in one span (kit `.rail-link > span`). */}
      {count !== undefined ? (
        <span>
          {children}
          <span className="ml-1.5 text-caption text-muted-foreground">{count}</span>
        </span>
      ) : (
        children
      )}
      <ChevronRight aria-hidden className="ml-auto size-3 text-muted-foreground" />
    </button>
  );
}

/**
 * One outline entry (kit `.ol`): a link to a section anchor with its count;
 * the current one is ink 500 with a 2px primary tick (scroll-spy sets it).
 */
export function OutlineRow({
  href,
  current,
  count,
  children,
  onClick,
}: {
  href: string;
  current?: boolean;
  count?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      // A block whose own text is the label (kit `.ol`): the count floats right and the label truncates beside it.
      className={cn(
        "relative -ml-3 block h-7 truncate rounded-sm pr-2 pl-3 text-caption leading-7 text-muted-foreground hover:bg-surface-hover hover:text-foreground pointer-coarse:h-11 pointer-coarse:leading-11",
        current &&
          "font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-xs before:bg-primary",
      )}
    >
      {/* Drawn first so it can float; read after the label. */}
      {count !== undefined ? (
        <span aria-hidden className="float-right mt-1.5 ml-2 leading-4 whitespace-nowrap tabular-nums pointer-coarse:mt-3.5">
          {count}
        </span>
      ) : null}
      {children}
      {count !== undefined ? <span className="sr-only"> {count}</span> : null}
    </a>
  );
}
