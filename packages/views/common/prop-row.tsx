import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/** Inline picker trigger that sits inside a `PropRow` value cell. */
export const PROP_ROW_TRIGGER_CLASS =
  "-mx-1 h-auto min-w-0 max-w-full justify-start gap-1.5 px-1 py-0.5 text-caption font-normal hover:bg-accent/30";

/**
 * Label / value row of a detail sidebar. It is a subgrid, so the parent
 * declares the tracks (`grid grid-cols-[auto_1fr]`) and the label column
 * sizes to the widest label across every row.
 */
export function PropRow({
  label,
  children,
  interactive = true,
}: {
  label: ReactNode;
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid items-center rounded-md px-2",
        interactive && "transition-colors hover:bg-accent/50",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5 text-caption">{children}</div>
    </div>
  );
}
