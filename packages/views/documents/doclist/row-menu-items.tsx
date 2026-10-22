import { Fragment, type ComponentType, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  CopyPlus,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  MonitorUp,
  Pencil,
  Share2,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { sourceLinkIcon } from "../source-links";
import type { LibraryRow } from "../library-rows";
import type { RowMenuGroup, RowMenuItem, RowMenuItemId } from "./row-menu";

const ITEM_CLASS = "gap-2 px-2 py-2 pointer-coarse:min-h-11";

const ICONS: Record<Exclude<RowMenuItemId, "go-to-source">, LucideIcon> = {
  open: ExternalLink,
  "open-folder": FolderOpen,
  "open-app": MonitorUp,
  share: Share2,
  "copy-link": Link2,
  star: Star,
  "new-subfolder": FolderPlus,
  rename: Pencil,
  move: FolderInput,
  duplicate: CopyPlus,
  download: Download,
  shelve: Archive,
  trash: Trash2,
  save: FolderInput,
  unshelve: ArchiveRestore,
  restore: ArchiveRestore,
  "view-details": Eye,
  purge: Trash2,
};

function iconOf(item: RowMenuItem, row: LibraryRow): LucideIcon {
  if (item.id === "go-to-source") return row.type === "source" ? sourceLinkIcon(row.source.parent) : Copy;
  // Unstar draws the struck-through star.
  if (item.id === "star" && item.labelKey.endsWith(".unstar")) return StarOff;
  return ICONS[item.id];
}

interface MenuItemProps {
  variant?: "default" | "destructive";
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * Draws the groups of `docRowMenu` with the primitives of one menu: the ⋯
 * dropdown and the right-click menu pass their own `Item` and `Separator`, so
 * both show one list. A separator sits between two groups, never at an end.
 */
export function RowMenuItems({
  groups,
  row,
  t,
  Item,
  Separator,
}: {
  groups: RowMenuGroup[];
  row: LibraryRow;
  t: (key: string) => string;
  Item: ComponentType<MenuItemProps>;
  Separator: ComponentType;
}) {
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group[0]?.id ?? index}>
          {index > 0 ? <Separator /> : null}
          {group.map((item) => {
            const Icon = iconOf(item, row);
            return (
              <Item key={item.id} variant={item.destructive ? "destructive" : "default"} className={ITEM_CLASS} onClick={item.run}>
                <Icon aria-hidden className="size-3.5" />
                {t(item.labelKey)}
              </Item>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
