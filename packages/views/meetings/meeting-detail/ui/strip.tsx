import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** Phone (< 600 content width): rows stack and their buttons fill the row at 44 (kit `.strip-row` @599). */
const PHONE_ROW = "@max-[37.5rem]/meeting:flex-col @max-[37.5rem]/meeting:items-stretch";
const PHONE_ACTIONS = "@max-[37.5rem]/meeting:*:h-11 @max-[37.5rem]/meeting:*:flex-auto";

/** The next-step strip (kit `.strip`): full content width between two hairlines, one row per job. */
export function Strip({ children, className, ...rest }: { children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <section {...rest} className={cn("mt-6 divide-y divide-border border-y border-border", className)}>
      {children}
    </section>
  );
}

/**
 * One strip row (kit `.strip-row`): ≥ 56 tall, text left, actions right.
 * `title` is the body line (bold parts in `<strong>`), `caption` the muted line
 * under it. Pass `children` instead of `title` for a row with its own layout
 * (a notice line, a lobby row).
 */
export function StripRow({
  title,
  caption,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-14 items-center justify-between gap-x-6 gap-y-3 py-4", PHONE_ROW, className)}>
      {children ?? (
        <div className="min-w-0 [&_strong]:font-semibold">
          <p className="text-body">{title}</p>
          {caption ? <p className="mt-0.5 text-caption text-muted-foreground">{caption}</p> : null}
        </div>
      )}
      {actions ? <div className={cn("flex flex-none flex-wrap items-center gap-2", PHONE_ACTIONS)}>{actions}</div> : null}
    </div>
  );
}
