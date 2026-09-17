"use client";

import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";

export type IconSelectItem = {
  value: string;
  label: string;
  icon?: ReactNode;
};

/**
 * Compact Select used by the create-task toolbar: trigger carries a field
 * icon, and every option can carry its own icon (Multica priority/status
 * parity). Labels stay the Select value map so SelectValue stays text.
 */
export function IconSelect({
  id,
  label,
  items,
  value,
  onValueChange,
  triggerIcon,
  triggerClassName,
}: {
  id: string;
  label: string;
  items: IconSelectItem[];
  value: string;
  onValueChange: (value: string | null) => void;
  triggerIcon: ReactNode;
  triggerClassName?: string;
}) {
  return (
    <Select items={items} value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} aria-label={label} size="sm" className={triggerClassName}>
        {triggerIcon}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.icon}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
