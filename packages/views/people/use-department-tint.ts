"use client";

import { useDepartments } from "@uniwork/core/people";
import type { Department } from "@uniwork/core/types/people";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { departmentTints } from "./identity-tint";

/**
 * Every card and row asks for a colour, so the mapping is built once per
 * department list (the query's cached array) and shared, rather than
 * re-sorted by each of them.
 */
const byList = new WeakMap<Department[], (departmentId: string) => Tint>();
const EMPTY: Department[] = [];

function tintsFor(departments: Department[]): (departmentId: string) => Tint {
  let tints = byList.get(departments);
  if (!tints) {
    tints = departmentTints(
      departments
        .filter((d) => !d.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"))
        .map((d) => d.id),
    );
    byList.set(departments, tints);
  }
  return tints;
}

/**
 * The colour of each department, the same on the chip row, the cards, the
 * table and a profile. Reads the organization's department list (one cached
 * query every directory screen already makes) in its own sort order.
 */
export function useDepartmentTint(): (departmentId: string) => Tint {
  // Optional so a card rendered on its own (tests, previews) still colours by hash.
  const orgSlug = useOptionalWorkspace()?.workspace.organization_slug ?? "";
  const { data } = useDepartments(orgSlug);
  return tintsFor(data ?? EMPTY);
}
