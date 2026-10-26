"use client";
import { useId, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; count?: number };

/**
 * The kit's segmented control (`.seg`): a native fieldset of radios, so arrows
 * move the choice and a screen reader hears one group with a name. `value`
 * null shows none chosen (an unanswered RSVP). `size="sm"` is the 32px scope
 * switch ("Của bạn 2 | Tất cả 4"). On phone and coarse pointers each choice
 * grows to 44.
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  size,
  disabled,
  className,
}: {
  legend: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: "sm";
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  const sm = size === "sm";
  return (
    <fieldset
      disabled={disabled}
      className={cn(
        "m-0 inline-flex min-w-0 divide-x divide-input overflow-hidden border border-input p-0 pointer-coarse:h-auto @max-[37.5rem]/meeting:h-auto",
        sm ? "h-8 rounded-md" : "h-10 rounded-control",
        className,
      )}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "group/seg inline-flex cursor-pointer items-center justify-center font-medium text-foreground hover:bg-surface-hover has-checked:bg-brand-subtle has-checked:text-brand-subtle-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:text-muted-foreground pointer-coarse:min-h-11 @max-[37.5rem]/meeting:min-h-11",
            sm ? "px-2.5 text-caption" : "px-3.5 text-body",
          )}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
          {option.count !== undefined ? (
            <span className="ml-1 text-muted-foreground tabular-nums group-has-checked/seg:text-inherit">{option.count}</span>
          ) : null}
        </label>
      ))}
    </fieldset>
  );
}

/** The 32px scope switch (kit `.seg.seg-sm`). */
export function SegmentedSm<T extends string>(props: Omit<Parameters<typeof Segmented<T>>[0], "size">) {
  return <Segmented {...props} size="sm" />;
}
