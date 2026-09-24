"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { isImeComposing } from "@uniwork/core/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

const HIGHLIGHT_CLASS = "bg-accent";
const ITEM_SELECTOR = "button[data-picker-item]:not(:disabled)";
const EMPTY_ITEM_ATTR = "data-picker-empty";

const isEmptyItem = (el: HTMLButtonElement | undefined) =>
  el?.hasAttribute(EMPTY_ITEM_ATTR) === true;

/** Default trigger chrome when callers do not pass `triggerRender` (PillButton). */
export const PICKER_TRIGGER_CLASS =
  "flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors overflow-hidden";

/**
 * PropertyPicker shell: one Popover for every create-task / detail
 * property field. Optional pinned search sits above the scrollable list;
 * callers own the trigger via `trigger` + `triggerRender` (PillButton).
 */
export function PropertyPicker({
  open,
  onOpenChange,
  trigger,
  triggerRender,
  width = "w-48",
  align = "end",
  side = "bottom",
  searchable = false,
  searchPlaceholder,
  searchAriaLabel,
  onSearchChange,
  header,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: ReactNode;
  triggerRender?: ReactElement;
  width?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  searchable?: boolean;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  onSearchChange?: (query: string) => void;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const placeholder = searchPlaceholder ?? "";
  const filterAria = searchAriaLabel ?? searchPlaceholder ?? "";
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const getItems = useCallback(() => {
    if (!listRef.current) return [];
    return Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR),
    );
  }, []);

  const pendingSearchHighlight = useRef(false);
  useEffect(() => {
    if (!pendingSearchHighlight.current) return;
    pendingSearchHighlight.current = false;
    const items = getItems();
    setHighlightedIndex(items.findIndex((item) => !isEmptyItem(item)));
  }, [children, getItems]);

  useEffect(() => {
    const items = getItems();
    for (const item of items) {
      item.classList.remove(HIGHLIGHT_CLASS);
    }
    if (highlightedIndex >= 0 && highlightedIndex < items.length) {
      items[highlightedIndex]?.classList.add(HIGHLIGHT_CLASS);
    }
  }, [highlightedIndex, getItems, children]);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      setQuery("");
      setHighlightedIndex(-1);
      onSearchChange?.("");
    }
    wasOpen.current = open;
  }, [open, onSearchChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeComposing(e)) return;
      const items = getItems();
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev < items.length - 1 ? prev + 1 : 0;
          items[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : items.length - 1;
          items[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < items.length) {
          items[highlightedIndex]?.click();
        } else if (items.length === 1 && !isEmptyItem(items[0])) {
          items[0]?.click();
        }
      }
    },
    [getItems, highlightedIndex],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={triggerRender ? undefined : PICKER_TRIGGER_CLASS}
        render={triggerRender}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent align={align} side={side} className={cn(width, "gap-0 p-0")}>
        {searchable ? (
          <div className="border-b border-surface-border/50 bg-surface-hover/20 px-2 py-1.5">
            <input
              type="text"
              name="property-picker-search"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                pendingSearchHighlight.current = true;
                onSearchChange?.(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label={filterAria}
              className="w-full rounded-md bg-transparent px-1 text-body outline-none transition-colors placeholder:text-muted-foreground focus-visible:bg-surface-hover/70 focus-visible:ring-1 focus-visible:ring-surface-border/70"
            />
          </div>
        ) : null}
        {header ? <div className="border-b border-surface-border/50">{header}</div> : null}
        <div ref={listRef} className="max-h-72 overscroll-contain overflow-y-auto p-1">
          {children}
        </div>
        {footer ? <div className="border-t border-surface-border/50 p-1">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}

export function PickerItem({
  selected,
  disabled,
  onClick,
  hoverClassName,
  emptyValue = false,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  hoverClassName?: string;
  emptyValue?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-picker-item
      aria-pressed={selected}
      {...(emptyValue ? { [EMPTY_ITEM_ATTR]: "" } : {})}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-body transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : (hoverClassName ?? "hover:bg-accent"),
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      <Check
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground",
          selected ? "" : "invisible",
        )}
        aria-hidden
      />
    </button>
  );
}

/** Visual group label shared by property pickers with heterogeneous options. */
export function PickerSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="px-2 pb-1 pt-2 text-micro font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

export function PickerEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-3 text-center text-body text-muted-foreground">{children}</div>
  );
}
