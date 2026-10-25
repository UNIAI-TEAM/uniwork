import type { ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A decision / question / note row (kit `.row`): a 56px time gutter (52 on
 * phone) and the text in body-lg at a 600 measure. `time` is a plain string for
 * a hand-written note (mono gutter time) or a node — a `TimeChipButton`, which
 * bleeds 6px left so its digits sit on the column edge. `author` is the note
 * author line, shown by the caller only when it changes.
 */
export function TimeGutterRow({
  time,
  author,
  children,
  className,
}: {
  time?: ReactNode;
  author?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("grid grid-cols-[56px_minmax(0,1fr)] items-start @max-[37.5rem]/meeting:grid-cols-[52px_minmax(0,1fr)]", className)}>
      {author ? <p className="col-start-2 mb-0.5 text-body font-semibold">{author}</p> : null}
      {typeof time === "string" ? (
        <time className="col-start-1 pt-0.75 font-mono text-caption font-medium text-muted-foreground">{time}</time>
      ) : (
        <span className="col-start-1 -ml-1.5 mt-px flex justify-self-start">{time}</span>
      )}
      <div className="col-start-2 min-w-0 max-w-150 text-body-lg">{children}</div>
    </li>
  );
}
