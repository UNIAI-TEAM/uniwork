"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDeletePin, usePins, useReorderPins } from "@uniwork/core/tasks";
import type { TaskPin } from "@uniwork/core/types/task-view";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@uniwork/ui/components/ui/sidebar";
import { useStatusCatalog } from "../tasks/pickers/status-catalog";
import { PinRow } from "./sidebar-pin-row";
import { SidebarPinsRail } from "./sidebar-pins-rail";

type WorkspacePaths = { task: (id: string) => string; project: (id: string) => string };

const SIDEBAR_PIN_TYPES = new Set(["task", "project"]);
const NO_PINS: TaskPin[] = [];

export function pinHref(ws: WorkspacePaths, pin: TaskPin): string {
  return pin.item_type === "task" ? ws.task(pin.item_id) : ws.project(pin.item_id);
}

/** The pins the sidebar lists: tasks and projects, in the server's order. */
export function useSidebarPins(wsId: string): TaskPin[] {
  const { data } = usePins(wsId);
  const pins = data?.pins ?? NO_PINS;
  return pins.some((p) => !SIDEBAR_PIN_TYPES.has(p.item_type))
    ? pins.filter((p) => SIDEBAR_PIN_TYPES.has(p.item_type))
    : pins;
}

/**
 * Keeps its own copy of the pins so a cache write landing mid-drag (the
 * optimistic reorder, a realtime refetch) cannot reorder rows under dnd-kit.
 */
function useDragStablePins(pins: TaskPin[]) {
  const [local, setLocal] = useState(pins);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(pins);
  }, [pins]);
  return { local, setLocal, dragging };
}

export function SidebarPins({
  wsId,
  ws,
  pathname,
  onNavigate,
}: {
  wsId: string;
  ws: WorkspacePaths;
  pathname: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const pins = useSidebarPins(wsId);
  const statuses = useStatusCatalog(wsId);
  const deletePin = useDeletePin(wsId);
  const reorderPins = useReorderPins(wsId);
  const { local, setLocal, dragging } = useDragStablePins(pins);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { mutate: removePin } = deletePin;
  const unpin = useCallback(
    (pin: TaskPin) => removePin({ itemType: pin.item_type, itemId: pin.item_id }),
    [removePin],
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    dragging.current = false;
    if (!over || active.id === over.id) return;
    const from = local.findIndex((p) => p.id === active.id);
    const to = local.findIndex((p) => p.id === over.id);
    if (from === -1 || to === -1) return;
    const reordered = arrayMove(local, from, to);
    setLocal(reordered);
    reorderPins.mutate(reordered);
  };

  if (local.length === 0) return null;

  return (
    <>
    <SidebarPinsRail
      pins={local}
      wsId={wsId}
      hrefOf={(pin) => pinHref(ws, pin)}
      pathname={pathname}
      statuses={statuses}
      onNavigate={onNavigate}
    />
    <Collapsible defaultOpen>
      <SidebarGroup className="group/pinned py-1 group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel
          render={<CollapsibleTrigger />}
          className="group/trigger h-7 cursor-pointer px-2 text-overline text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
        >
          <span>{t("nav.pinned")}</span>
          <ChevronRight
            aria-hidden
            className="ml-1 size-3! transition-transform duration-(--duration-fast) group-data-[panel-open]/trigger:rotate-90"
          />
          <span
            aria-hidden
            className="ml-auto text-caption opacity-0 transition-opacity group-hover/pinned:opacity-100"
          >
            {local.length}
          </span>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => {
                dragging.current = true;
              }}
              onDragCancel={() => {
                dragging.current = false;
              }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={local.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <SidebarMenu className="gap-0.5" aria-label={t("nav.pinned")}>
                  {local.map((pin) => (
                    <PinRow
                      key={pin.id}
                      pin={pin}
                      wsId={wsId}
                      href={pinHref(ws, pin)}
                      pathname={pathname}
                      statuses={statuses}
                      onUnpin={() => unpin(pin)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </SidebarMenu>
              </SortableContext>
            </DndContext>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
    </>
  );
}
