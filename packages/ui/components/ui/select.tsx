"use client";
import { Select as BaseSelect } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectItem {
  value: string;
  label: string;
}

export function Select({
  items,
  value,
  onValueChange,
  placeholder,
  className,
}: {
  items: SelectItem[];
  value: string | null;
  onValueChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <BaseSelect.Root
      items={items}
      value={value}
      onValueChange={(v) => onValueChange(v as string | null)}
    >
      <BaseSelect.Trigger
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-[var(--uw-radius)] border border-line bg-surface px-2.5 text-sm text-primary",
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon>
          <ChevronDown className="size-4 text-tertiary" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
          <BaseSelect.Popup className="min-w-[var(--anchor-width)] rounded-[var(--uw-radius)] border border-line bg-surface p-1 shadow-lg">
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className="cursor-default rounded px-2 py-1 text-sm text-primary data-[highlighted]:bg-subtle"
                >
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
