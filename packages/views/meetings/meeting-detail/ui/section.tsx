import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A main-column section (kit `.section` + `.sh`): 40 above (32 for the first,
 * 32 on phone), heading title-sm with a caption count and an end control, then
 * an optional byline and the content 12 below. `id` is the anchor the outline
 * and deep links scroll to; the heading gets `${id}-heading`.
 */
export function Section({
  id,
  title,
  count,
  end,
  byline,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  count?: ReactNode;
  end?: ReactNode;
  byline?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("mt-10 scroll-mt-6 first:mt-8 @max-[37.5rem]/meeting:mt-8", className)}
    >
      <div className="flex items-baseline gap-2">
        <h2 id={headingId} className="text-title-sm font-semibold">
          {title}
        </h2>
        {count !== undefined ? <span className="text-caption text-muted-foreground">{count}</span> : null}
        {end ? <div className="ml-auto self-center">{end}</div> : null}
      </div>
      {byline}
      {children !== undefined ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

/**
 * One caption line under a heading (kit `.byline`), with an optional 12px
 * glyph and a trailing inline text button passed as children.
 */
export function Byline({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <p className={cn("mt-1 text-caption text-muted-foreground [&_time]:tabular-nums", className)}>
      {Icon ? <Icon aria-hidden className="mr-1.5 inline-block size-3 -translate-y-0.5" /> : null}
      <span>{children}</span>
    </p>
  );
}
