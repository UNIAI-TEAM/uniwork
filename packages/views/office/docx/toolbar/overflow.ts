import type { DocxToolbarGroup } from "./types";

export interface DocxToolbarOverflowPartition {
  inline: DocxToolbarGroup[];
  collapsed: DocxToolbarGroup[];
}

/** Lower-priority groups collapse into the overflow menu once the toolbar is
 * narrower than their `collapseAt` width; 0 (or absent) never collapses. */
export function partitionToolbarGroups(
  groups: readonly DocxToolbarGroup[],
  width: number,
): DocxToolbarOverflowPartition {
  const inline: DocxToolbarGroup[] = [];
  const collapsed: DocxToolbarGroup[] = [];
  for (const group of groups) {
    const collapseAt = group.collapseAt ?? 0;
    if (collapseAt > 0 && width < collapseAt) collapsed.push(group);
    else inline.push(group);
  }
  return { inline, collapsed };
}
