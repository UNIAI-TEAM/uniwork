/**
 * Caps visual indent so deep branches (up to TREE_MAX_LEVEL = 20) keep a
 * readable label inside the 256px sidebar without horizontal scroll:
 * 20px/level (chevron slot 16 + gap 4) through depth 6 so each child's
 * chevron column sits under its parent's icon, capped at 120px (depth >= 6).
 */
export function treeRowPaddingLeft(depth: number): number {
  return Math.min(8 + depth * 20, 120);
}

// A tree row is chevron slot (size-4 = 16px, -mr-1 pulls the next item 4px
// back) then a gap-2 (8px) before the 20px icon box.
const TREE_CHEVRON_SLOT = 16;
const TREE_CHEVRON_PULL = 4;
const TREE_ROW_GAP = 8;
const TREE_ICON_BOX = 20;

/**
 * Left edge of the icon box of a tree row at `depth`, from the row's own
 * border box. A row that is not a tree row but sits in the tree's columns
 * (a Drive folder) takes this as its `paddingLeft` and lands on the same
 * icon and name columns as the folder-tree level it belongs to.
 */
export function treeIconLeft(depth: number): number {
  return treeRowPaddingLeft(depth) + TREE_CHEVRON_SLOT - TREE_CHEVRON_PULL + TREE_ROW_GAP;
}

/**
 * Left edge of the name of a tree row at `depth`: the icon box plus the row gap
 * after `treeIconLeft`. A Drive folder row's name, and the loading and error
 * text under an account, start here.
 */
export function treeNameLeft(depth: number): number {
  return treeIconLeft(depth) + TREE_ICON_BOX + TREE_ROW_GAP;
}
