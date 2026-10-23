"use client";

import { useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TaskProperty } from "@uniwork/core/types";
import { tintSolidClass } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { tintFromColor } from "@uniwork/ui/lib/tint-from-color";
import { cn } from "@uniwork/ui/lib/utils";
import { PropertyValueDisplay } from "./property-value-display";
import { propertyOptions, readPropertyValue } from "./property-value";

function OptionDot({ color }: { color?: string }) {
  return (
    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tintSolidClass[tintFromColor(color)])} />
  );
}

type SelectEditorProps = {
  property: TaskProperty;
  value: unknown;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (value: unknown) => void;
  onClear: () => void;
  ariaLabel: string;
  triggerClassName?: string;
  onTriggerNavigationGuard?: (event: SyntheticEvent) => void;
};

/** Trigger + menu shell shared by the select and multi_select editors: same
 * open/disabled handling as `EnumFieldPicker` / `LabelPicker`
 * (`packages/views/tasks/pickers/`) since neither of those is generic enough
 * to take a property's own option list and colour. */
function useSelectMenuState(disabled: boolean | undefined) {
  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);
  return { open: disabled ? false : open, setOpen: (next: boolean) => { if (!disabled) setOpen(next); } };
}

export function PropertySelectEditor({
  property,
  value,
  disabled,
  disabledReason,
  onChange,
  onClear,
  ariaLabel,
  triggerClassName,
  onTriggerNavigationGuard,
}: SelectEditorProps) {
  const { t } = useTranslation();
  const { open, setOpen } = useSelectMenuState(disabled);
  const options = propertyOptions(property);
  const selected = readPropertyValue(property, value) as string | undefined;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        onPointerDown={onTriggerNavigationGuard}
        onClick={onTriggerNavigationGuard}
        onAuxClick={onTriggerNavigationGuard}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled || undefined}
            aria-label={ariaLabel}
            title={disabled ? disabledReason : undefined}
          />
        }
      >
        <PropertyValueDisplay property={property} value={value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onAuxClick={onTriggerNavigationGuard}>
        {selected !== undefined ? (
          <DropdownMenuItem
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            {t("tasks.properties.clear")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuRadioGroup
          value={selected ?? undefined}
          onValueChange={(next) => {
            if (next) onChange(next);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              <OptionDot color={option.color} />
              <span className="truncate">{option.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PropertyMultiSelectEditor({
  property,
  value,
  disabled,
  disabledReason,
  onChange,
  onClear,
  ariaLabel,
  triggerClassName,
  onTriggerNavigationGuard,
}: SelectEditorProps) {
  const { t } = useTranslation();
  const { open, setOpen } = useSelectMenuState(disabled);
  const options = propertyOptions(property);
  const selected = new Set((readPropertyValue(property, value) as string[] | undefined) ?? []);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    if (next.size === 0) onClear();
    else onChange([...next]);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        onPointerDown={onTriggerNavigationGuard}
        onClick={onTriggerNavigationGuard}
        onAuxClick={onTriggerNavigationGuard}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled || undefined}
            aria-label={ariaLabel}
            title={disabled ? disabledReason : undefined}
          />
        }
      >
        <PropertyValueDisplay property={property} value={value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onAuxClick={onTriggerNavigationGuard} className="max-h-72 w-56 overflow-y-auto">
        {selected.size > 0 ? (
          <DropdownMenuItem
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            {t("tasks.properties.clear")}
          </DropdownMenuItem>
        ) : null}
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selected.has(option.id)}
            closeOnClick={false}
            onCheckedChange={(checked) => toggle(option.id, checked)}
          >
            <OptionDot color={option.color} />
            <span className="truncate">{option.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
