import {
  Calendar,
  FileText,
  FolderKanban,
  House,
  Inbox,
  ListTodo,
  Mail,
  MessageSquare,
  Settings,
  SquareCheckBig,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { ModuleKey } from "./module-tones";

/**
 * One glyph per module, beside its tint in module-tones.ts: the sidebar, page
 * headers, empty states, search, the work graph and notifications draw a
 * module with the same icon, so the shape alone says where something lives.
 * Meetings is a camera, not a calendar — Calendar already sits one row above
 * it in the sidebar. docs/conventions.md › Icons.
 */
export const MODULE_ICONS = {
  home: House,
  inbox: Inbox,
  email: Mail,
  tasks: SquareCheckBig,
  my_tasks: ListTodo,
  projects: FolderKanban,
  meetings: Video,
  chat: MessageSquare,
  people: Users,
  documents: FileText,
  calendar: Calendar,
  settings: Settings,
} as const satisfies Record<ModuleKey, LucideIcon>;
