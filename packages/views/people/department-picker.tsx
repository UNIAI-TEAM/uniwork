"use client";

import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Department } from "@uniwork/core/types/people";
import { Select } from "@uniwork/ui/components/ui/select";

/**
 * Department chooser for the profile form. The tree is at most two levels, so
 * a child is named with its parent ("Kỹ thuật › Frontend") rather than drawn
 * in a tree widget nobody needs at this depth — and not by a dash typed into
 * the label, which a screen reader reads out. Order is the organization's
 * own, the same as the directory's chip row.
 */
export function DepartmentPicker({
  departments,
  value,
  onValueChange,
  disabled,
  allowNone = true,
  id,
  ariaLabel,
}: {
  departments: Department[];
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  allowNone?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => {
    const bySort = (a: Department, b: Department) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi");
    const roots = departments.filter((d) => !d.parent_id).sort(bySort);
    const childrenOf = (parentId: string) => departments.filter((d) => d.parent_id === parentId).sort(bySort);
    const rows = roots.flatMap((root) => [
      { value: root.id, label: root.name as React.ReactNode },
      ...childrenOf(root.id).map((child) => ({
        value: child.id,
        label: (
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="text-muted-foreground">{root.name}</span>
            <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
            <span className="truncate">{child.name}</span>
          </span>
        ),
      })),
    ]);
    return allowNone ? [{ value: NONE, label: t("people.department_none") }, ...rows] : rows;
  }, [allowNone, departments, t]);

  return (
    <Select
      id={id}
      aria-label={ariaLabel ?? t("people.department")}
      disabled={disabled}
      value={value === "" ? NONE : value}
      onValueChange={(next) => onValueChange(next === NONE ? "" : (next ?? ""))}
      items={items}
    />
  );
}

/**
 * The Select primitive treats an empty string as "nothing selected", which is
 * not the same as the explicit "no department" choice, so that choice carries
 * its own sentinel value and is translated back at the boundary.
 */
const NONE = "__none__";
