"use client";

/**
 * A keyboard-navigable single-select listbox (B6ui). Selection follows focus:
 * ArrowUp/Down, Home and End move and select; Escape clears when `onClear` is
 * given. Shared by the parts list and the element list.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export interface MasterSelectItem {
  key: string;
  content: ReactNode;
  indent?: boolean;
}

interface MasterSelectListProps {
  label: string;
  items: readonly MasterSelectItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  testId: string;
}

export function MasterSelectList({
  label,
  items,
  selectedKey,
  onSelect,
  onClear,
  disabled = false,
  testId,
}: MasterSelectListProps) {
  const base = useId();
  const index = items.findIndex((item) => item.key === selectedKey);
  const optionId = (i: number) => base + "-" + String(i);

  const move = (to: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, to))];
    if (next) onSelect(next.key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (disabled || items.length === 0) return;
    switch (event.key) {
      case "ArrowDown": move(index < 0 ? 0 : index + 1); break;
      case "ArrowUp": move(index < 0 ? items.length - 1 : index - 1); break;
      case "Home": move(0); break;
      case "End": move(items.length - 1); break;
      case "Escape":
        if (!onClear) return;
        onClear();
        break;
      default: return;
    }
    event.preventDefault();
  };

  return (
    <ul
      role="listbox"
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-activedescendant={index >= 0 ? optionId(index) : undefined}
      tabIndex={disabled ? -1 : 0}
      data-testid={testId}
      onKeyDown={onKeyDown}
      className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-background p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {items.map((item, i) => {
        const selected = i === index;
        return (
          // Keyboard selection is handled once on the listbox (aria-activedescendant pattern).
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={item.key}
            id={optionId(i)}
            role="option"
            aria-selected={selected}
            data-key={item.key}
            onClick={() => {
              if (!disabled) onSelect(item.key);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-label text-foreground hover:bg-muted",
              item.indent && "pl-5",
              selected && "bg-accent text-accent-foreground",
              disabled && "cursor-default opacity-60",
            )}
          >
            {item.content}
          </li>
        );
      })}
    </ul>
  );
}
