"use client";

import { useEffect, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useProject, useTask } from "@uniwork/core/tasks";
import type { TaskPin } from "@uniwork/core/types/task-view";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";
import { ProjectIcon } from "../projects/components/project-icon";
import type { StatusCatalog } from "../tasks/pickers/status-catalog";
import { StatusOptionIcon } from "../tasks/pickers/status-picker";
import { AppLink } from "../navigation";

const pinButtonClass =
  "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground";

function SortablePinItem({
  pin,
  href,
  active,
  label,
  icon,
  onUnpin,
  onNavigate,
}: {
  pin: TaskPin;
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onUnpin: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id });
  // The click that ends a drag must not also open the item.
  const wasDragged = useRef(false);
  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-60")}
      {...listeners}
    >
      <SidebarMenuButton
        size="sm"
        isActive={active}
        className={cn(pinButtonClass, isDragging && "pointer-events-none")}
        render={
          <AppLink
            href={href}
            draggable={false}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (wasDragged.current) {
                wasDragged.current = false;
                event.preventDefault();
                return;
              }
              onNavigate();
            }}
          />
        }
      >
        {icon}
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        type="button"
        aria-label={t("nav.pinned_unpin", { name: label })}
        title={t("nav.pinned_unpin", { name: label })}
        className="text-muted-foreground [&>svg]:size-3.5"
        onClick={onUnpin}
      >
        <X aria-hidden />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

export function PinSkeleton() {
  return (
    <SidebarMenuItem aria-hidden>
      <div className="flex h-7 w-full items-center gap-2 px-2">
        <div className="size-3.5 shrink-0 rounded-sm bg-sidebar-accent/60" />
        <div className="h-3 w-24 rounded bg-sidebar-accent/60" />
      </div>
    </SidebarMenuItem>
  );
}

type PinItem =
  | { state: "pending" }
  | { state: "missing"; notFound: boolean }
  | { state: "ready"; label: string; icon: React.ReactNode };

/** A pinned task's or project's name and icon, from the item's own detail query. */
export function usePinItem(pin: TaskPin, wsId: string, statuses: StatusCatalog): PinItem {
  const isTask = pin.item_type === "task";
  const taskQuery = useTask(isTask ? pin.item_id : "");
  const projectQuery = useProject(wsId, pin.item_type === "project" ? pin.item_id : "");
  const query = isTask ? taskQuery : projectQuery;
  if (query.isPending) return { state: "pending" };
  const notFound = query.error instanceof ApiError && query.error.status === 404;
  if (isTask) {
    const task = taskQuery.data;
    if (!task) return { state: "missing", notFound };
    return {
      state: "ready",
      label: task.title,
      icon: <StatusOptionIcon option={statuses.optionOf(task.status)} className="size-3.5! shrink-0" />,
    };
  }
  const project = projectQuery.data;
  if (!project) return { state: "missing", notFound };
  return { state: "ready", label: project.title, icon: <ProjectIcon project={project} size="sm" /> };
}

/**
 * One pinned task or project in the expanded sidebar. An item the server no
 * longer has (404) unpins itself; any other failure only hides the row, so a
 * transient error never drops a pin.
 */
export function PinRow({
  pin,
  wsId,
  href,
  pathname,
  statuses,
  onUnpin,
  onNavigate,
}: {
  pin: TaskPin;
  wsId: string;
  href: string;
  pathname: string;
  statuses: StatusCatalog;
  onUnpin: () => void;
  onNavigate: () => void;
}) {
  const item = usePinItem(pin, wsId, statuses);
  const notFound = item.state === "missing" && item.notFound;

  const unpinned = useRef(false);
  useEffect(() => {
    if (unpinned.current || !notFound) return;
    unpinned.current = true;
    onUnpin();
  }, [notFound, onUnpin]);

  if (item.state === "pending") return <PinSkeleton />;
  if (item.state === "missing") return null;
  return (
    <SortablePinItem
      pin={pin}
      href={href}
      active={pathname === href}
      label={item.label}
      icon={item.icon}
      onUnpin={onUnpin}
      onNavigate={onNavigate}
    />
  );
}
