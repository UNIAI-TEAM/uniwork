"use client";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export const OTHER_INPUT_MAX_LENGTH = 80;

export interface QuestionOption {
  slug: string;
  icon: ReactNode;
  label: string;
  isOther?: boolean;
}

/**
 * Một lựa chọn dạng chip, wrap theo bề rộng cột. `mode` quyết định ARIA role
 * (radio cho chọn một, checkbox cho chọn nhiều); hình thức giống nhau.
 */
export function IconOptionCard({
  icon,
  label,
  selected,
  onSelect,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  mode?: "radio" | "checkbox";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      role={mode}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(selected && "border-brand/40 bg-brand/5")}
    >
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center text-secondary [&_svg]:size-4", selected && "text-brand")}
      >
        {icon}
      </span>
      <span>{label}</span>
      {selected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
    </Button>
  );
}

/**
 * Biến thể "Khác": khi chọn, nhãn thành input không viền cùng cỡ chữ với chip.
 * Auto-focus khi mở; Enter (có nội dung) → onConfirm của cha.
 */
export function IconOtherOptionCard({
  icon,
  label,
  selected,
  onSelect,
  otherValue,
  onOtherChange,
  onConfirm,
  placeholder,
  mode = "radio",
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onSelect: () => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  onConfirm: () => void;
  placeholder: string;
  mode?: "radio" | "checkbox";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      role={mode}
      aria-checked={selected}
      onClick={() => {
        if (!selected) onSelect();
      }}
      className={cn(selected && "border-brand/40 bg-brand/5")}
    >
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center text-secondary [&_svg]:size-4", selected && "text-brand")}
      >
        {icon}
      </span>
      {selected ? (
        <input
          autoFocus
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && otherValue.trim()) {
              e.preventDefault();
              onConfirm();
            }
          }}
          placeholder={placeholder}
          maxLength={OTHER_INPUT_MAX_LENGTH}
          aria-label={placeholder}
          className="w-32 min-w-0 border-0 bg-transparent p-0 text-inherit placeholder:text-tertiary focus:outline-none"
        />
      ) : (
        <span>{label}</span>
      )}
    </Button>
  );
}
