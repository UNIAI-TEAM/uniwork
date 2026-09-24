"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Department } from "@uniwork/core/types/people";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { useDepartmentTint } from "./use-department-tint";

/**
 * Departments as one row of chips under the toolbar: the filter people use
 * most becomes one click instead of three levels of menu, and each chip says
 * how many people are behind it before it is pressed.
 *
 * The tree is at most two levels. A child follows its parent and is named
 * with its parent for assistive tech, not by a dash drawn into the text. Archived departments are left out: nobody is filed under them any
 * more.
 */
export function PeopleDepartmentBar({
  departments,
  value,
  onChange,
}: {
  departments: Department[];
  value: string;
  onChange: (departmentId: string) => void;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => orderDepartments(departments), [departments]);
  const tintFor = useDepartmentTint();
  if (items.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t("people.department")}
      className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]"
    >
      <Chip selected={value === ""} onSelect={() => onChange("")} label={t("people.department_any")} />
      {items.map(({ department, parentName }) => (
        <Chip
          key={department.id}
          selected={value === department.id}
          onSelect={() => onChange(value === department.id ? "" : department.id)}
          label={department.name}
          context={parentName ? t("people.department_child_of", { parent: parentName }) : undefined}
          count={department.member_count}
          countLabel={t("people.department_count", { count: department.member_count })}
          dotClass={tintForegroundClass[tintFor(department.id)]}
        />
      ))}
    </div>
  );
}

function Chip({
  selected,
  onSelect,
  label,
  context,
  count,
  countLabel,
  dotClass,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  /** Read after the label by assistive tech only, e.g. which parent a child sits under. */
  context?: string;
  count?: number;
  countLabel?: string;
  dotClass?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-label whitespace-nowrap transition-colors duration-[var(--duration-fast)] pointer-coarse:min-h-11 active:scale-[0.98]",
        selected
          ? "border-transparent bg-brand-subtle font-medium text-brand-subtle-foreground"
          : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {dotClass ? (
        <span aria-hidden="true" className={cn("size-2 rounded-full bg-current", dotClass)} />
      ) : null}
      {label}
      {context ? <span className="sr-only">{context}</span> : null}
      {count !== undefined ? (
        <>
          <span aria-hidden="true" className="text-caption tabular-nums opacity-70">
            {count}
          </span>
          <span className="sr-only">{countLabel}</span>
        </>
      ) : null}
    </button>
  );
}

/** Roots in sort order, each followed by its own children. */
function orderDepartments(departments: Department[]): { department: Department; parentName?: string }[] {
  const live = departments.filter((d) => !d.archived_at);
  const bySort = (a: Department, b: Department) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi");
  const roots = live.filter((d) => !d.parent_id).sort(bySort);
  return roots.flatMap((root) => [
    { department: root },
    ...live
      .filter((d) => d.parent_id === root.id)
      .sort(bySort)
      .map((child) => ({ department: child, parentName: root.name })),
  ]);
}
