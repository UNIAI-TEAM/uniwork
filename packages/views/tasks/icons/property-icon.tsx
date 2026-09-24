import type { TaskProperty } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import {
  Bookmark,
  BriefcaseBusiness,
  Bug,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock3,
  Code2,
  Database,
  Flag,
  FolderKanban,
  Gauge,
  Globe2,
  Hash,
  Heart,
  Layers3,
  Lightbulb,
  Link,
  ListChecks,
  LockKeyhole,
  MapPin,
  Megaphone,
  Milestone,
  Package,
  Palette,
  Rocket,
  Shapes,
  Shield,
  SignalHigh,
  Sparkles,
  Star,
  Tag,
  Target,
  UserRound,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

type PropertyIconOption = { value: string; label: string; Icon: LucideIcon };

export const PROPERTY_ICON_OPTIONS = [
  { value: "circle-dot", label: "Status", Icon: CircleDot },
  { value: "signal-high", label: "Priority", Icon: SignalHigh },
  { value: "user-round", label: "Assignee", Icon: UserRound },
  { value: "folder-kanban", label: "Project", Icon: FolderKanban },
  { value: "calendar-days", label: "Date", Icon: CalendarDays },
  { value: "tag", label: "Label", Icon: Tag },
  { value: "milestone", label: "Milestone", Icon: Milestone },
  { value: "flag", label: "Flag", Icon: Flag },
  { value: "bookmark", label: "Bookmark", Icon: Bookmark },
  { value: "star", label: "Star", Icon: Star },
  { value: "target", label: "Target", Icon: Target },
  { value: "shield", label: "Shield", Icon: Shield },
  { value: "bug", label: "Bug", Icon: Bug },
  { value: "zap", label: "Lightning", Icon: Zap },
  { value: "rocket", label: "Rocket", Icon: Rocket },
  { value: "sparkles", label: "Sparkles", Icon: Sparkles },
  { value: "lightbulb", label: "Idea", Icon: Lightbulb },
  { value: "globe-2", label: "Globe", Icon: Globe2 },
  { value: "link", label: "Link", Icon: Link },
  { value: "hash", label: "Number", Icon: Hash },
  { value: "list-checks", label: "Checklist", Icon: ListChecks },
  { value: "circle-check", label: "Complete", Icon: CircleCheck },
  { value: "clock-3", label: "Time", Icon: Clock3 },
  { value: "briefcase-business", label: "Work", Icon: BriefcaseBusiness },
  { value: "layers-3", label: "Layers", Icon: Layers3 },
  { value: "gauge", label: "Gauge", Icon: Gauge },
  { value: "database", label: "Database", Icon: Database },
  { value: "code-2", label: "Code", Icon: Code2 },
  { value: "palette", label: "Design", Icon: Palette },
  { value: "megaphone", label: "Announcement", Icon: Megaphone },
  { value: "map-pin", label: "Location", Icon: MapPin },
  { value: "package", label: "Package", Icon: Package },
  { value: "wrench", label: "Tools", Icon: Wrench },
  { value: "heart", label: "Favorite", Icon: Heart },
  { value: "circle-alert", label: "Alert", Icon: CircleAlert },
  { value: "lock-keyhole", label: "Private", Icon: LockKeyhole },
] satisfies PropertyIconOption[];

const defaultIconByType: Record<string, string> = {
  checkbox: "circle-check",
  date: "calendar-days",
  multi_select: "list-checks",
  number: "hash",
  select: "list-checks",
  text: "shapes",
  url: "link",
};

function configuredIcon(property: Pick<TaskProperty, "type" | "config">): string {
  const value = property.config?.icon;
  return typeof value === "string" ? value : (defaultIconByType[property.type] ?? "shapes");
}

export function PropertyIconGlyph({ icon, className }: { icon: string; className?: string }) {
  const Glyph = PROPERTY_ICON_OPTIONS.find((option) => option.value === icon)?.Icon ?? Shapes;
  return (
    <Glyph
      aria-hidden
      data-property-icon={icon}
      className={cn("size-4 shrink-0", className)}
    />
  );
}

export function PropertyIcon({
  property,
  className,
}: {
  property: Pick<TaskProperty, "type" | "config">;
  className?: string;
}) {
  return <PropertyIconGlyph icon={configuredIcon(property)} className={className} />;
}
