import {
  Archive,
  Clock,
  Folder,
  FolderLock,
  House,
  Share2,
  Star,
  Trash,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The glyph of every non-module row in the Documents navigation, in one
 * place: the sidebar draws each at `size-4` in `text-muted-foreground`, no
 * tile (docs/conventions.md › Icons). Rows that come from another module
 * (Chat, Meetings, Email, Tasks) use `MODULE_ICONS` and the module tint
 * instead. `archive` and `myFolders` name rows the design has that the
 * sidebar does not draw directly.
 */
export const DOCUMENTS_NAV_ICONS = {
  home: House,
  myFolders: FolderLock,
  recent: Clock,
  starred: Star,
  shared: Users,
  sharedByMe: Share2,
  archive: Archive,
  trash: Trash,
  folder: Folder,
} as const satisfies Record<string, LucideIcon>;
