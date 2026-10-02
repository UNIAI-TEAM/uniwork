"use client";

import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { foldedIncludes } from "../../common/search-fold";
import { PillButton } from "../../common/pill-button";
import {
  PickerEmpty,
  PickerItem,
  PropertyPicker,
  type PickerAnchor,
} from "./property-picker";
import { SEARCHABLE_OPTION_THRESHOLD } from "./searchable-option-picker";
import { usePickerTriggerLabel } from "./trigger-label";

export type EnumOption = {
  value: string;
  /** Searched, and the row's accessible name. */
  label: string;
  /** What the row shows; defaults to the label as text. */
  content?: ReactNode;
  hoverClassName?: string;
};

/**
 * Single-select picker over a finite list (status, priority, project), built
 * on the PropertyPicker popover every property field shares. A list longer
 * than SEARCHABLE_OPTION_THRESHOLD gets a pinned search box when the caller
 * names it with `searchPlaceholder`.
 *
 * `onTriggerNavigationGuard` keeps every interaction from reaching an
 * enclosing row's navigation handler: trigger pointerdown, click and middle
 * click (separate events — stopping one does not stop the others), and every
 * click inside the portalled popup, which React still bubbles through the
 * component tree to the row. Enter in the search box clicks the highlighted
 * item, so it goes through the popup guard too.
 *
 * `disabled` never reaches a native `disabled` attribute: the trigger keeps
 * `aria-disabled` and stays in the tab order, and the list is held closed.
 *
 * A row action opens it from a menu instead of a trigger: pass `open` /
 * `onOpenChange` and an `anchor`; no trigger is rendered then.
 */
export function EnumFieldPicker({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  valueLabel,
  searchPlaceholder,
  noResultsLabel,
  onTriggerNavigationGuard,
  triggerClassName,
  appearance = "ghost",
  width = "w-52",
  align = "start",
  open: controlledOpen,
  onOpenChange,
  anchor,
  children,
}: {
  value: string | null;
  options: EnumOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** The value the trigger shows, as text. Joined into the accessible name
   * ("field: value") so the name contains what is visible; omit it only when
   * the trigger shows a fixed action label. */
  valueLabel?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
  triggerClassName?: string;
  /** "pill" is the create-dialog / composer chrome, "ghost" everything else. */
  appearance?: "ghost" | "pill";
  width?: string;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchor?: PickerAnchor;
  children?: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [query, setQuery] = useState("");
  // A controlled close never fires onOpenChange, so disabling an open list
  // would leave `open` true and it would pop back when `disabled` clears.
  // Reset it during render, before anything commits.
  if (disabled && internalOpen) setInternalOpen(false);
  const open = controlledOpen ?? internalOpen;
  const triggerLabel = usePickerTriggerLabel(ariaLabel, valueLabel);

  const searchable = Boolean(searchPlaceholder) && options.length > SEARCHABLE_OPTION_THRESHOLD;
  const shown = searchable && query
    ? options.filter((option) => foldedIncludes(option.label, query))
    : options;

  const handleOpenChange = (next: boolean) => {
    if (disabled && next) return;
    setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setQuery("");
  };

  const triggerProps = {
    className: triggerClassName,
    "aria-disabled": disabled || undefined,
    "aria-label": triggerLabel,
    onPointerDown: onTriggerNavigationGuard,
    onClick: onTriggerNavigationGuard,
    onAuxClick: onTriggerNavigationGuard,
  };

  return (
    <PropertyPicker
      open={disabled ? false : open}
      onOpenChange={handleOpenChange}
      width={width}
      align={align}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      searchAriaLabel={searchPlaceholder}
      onSearchChange={setQuery}
      popupEventGuard={onTriggerNavigationGuard}
      anchor={anchor}
      triggerRender={
        appearance === "pill" ? (
          <PillButton {...triggerProps} />
        ) : (
          <Button type="button" variant="ghost" size="sm" {...triggerProps} />
        )
      }
      trigger={children}
    >
      {shown.map((option) => (
        <PickerItem
          key={option.value}
          selected={option.value === value}
          hoverClassName={option.hoverClassName}
          onClick={() => {
            onChange(option.value);
            handleOpenChange(false);
          }}
        >
          {option.content ?? <span className="truncate">{option.label}</span>}
        </PickerItem>
      ))}
      {shown.length === 0 && noResultsLabel ? <PickerEmpty>{noResultsLabel}</PickerEmpty> : null}
    </PropertyPicker>
  );
}
