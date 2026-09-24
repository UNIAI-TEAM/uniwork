"use client";

import { useMemo } from "react";
import { useDepartments } from "@uniwork/core/people";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { departmentTints } from "./identity-tint";

/**
 * The colour of each department, the same on the chip row, the cards, the
 * table and a profile. Reads the organization's department list (one cached
 * query every directory screen already makes) in its own sort order.
 */
export function useDepartmentTint(): (departmentId: string) => Tint {
  // Optional so a card rendered on its own (tests, previews) still colours by hash.
  const orgSlug = useOptionalWorkspace()?.workspace.organization_slug ?? "";
  const { data } = useDepartments(orgSlug);
  return useMemo(() => {
    const ordered = [...(data ?? [])]
      .filter((d) => !d.archived_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"))
      .map((d) => d.id);
    return departmentTints(ordered);
  }, [data]);
}
