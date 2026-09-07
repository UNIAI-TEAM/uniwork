"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Department } from "@uniwork/core/types/people";
import { Select } from "@uniwork/ui/components/ui/select";

/**
 * Department chooser, used by both the profile form and the directory filter.
 * The tree is at most two levels, so nesting is shown by indenting the child
 * label rather than by a tree widget nobody needs at this depth.
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
    const roots = departments.filter((d) => !d.parent_id);
    const childrenOf = (parentId: string) => departments.filter((d) => d.parent_id === parentId);
    const rows = roots.flatMap((root) => [
      { value: root.id, label: root.name },
      ...childrenOf(root.id).map((child) => ({ value: child.id, label: `— ${child.name}` })),
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
