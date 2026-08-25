"use client";
import { cn } from "@uniwork/ui/lib/utils";

export function RadioMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] transition-colors",
        selected ? "border-primary" : "border-line-strong",
      )}
    >
      {selected && <span className="absolute inset-[3px] rounded-full bg-primary" />}
    </span>
  );
}

/** Card chọn có viền đậm khi chọn (dùng cho org/workspace có sẵn, tạo mới). */
export const pickerCardClass = (selected: boolean) =>
  cn(
    "w-full rounded-lg border bg-surface text-left transition-all",
    selected
      ? "border-primary shadow-[inset_0_0_0_1px_var(--uw-text-primary)]"
      : "border-line hover:border-line-strong hover:bg-subtle/60",
  );
