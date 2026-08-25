"use client";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

// Màu chỉ là signal: priority cao/khẩn mới có màu, còn lại grayscale.
const priorityClass: Record<Task["priority"], string> = {
  low: "text-muted-foreground",
  medium: "text-muted-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        "block w-full rounded-lg border border-border bg-surface p-2.5 text-left hover:border-input",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="text-body text-foreground">{task.title}</div>
      <div className="mt-1 flex items-center gap-2 text-caption">
        {task.kind === "welcome" && (
          <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-micro font-medium text-brand">{t("workspace.guideBadge")}</span>
        )}
        <span className={priorityClass[task.priority]}>{t(`tasks.priority_${task.priority}`)}</span>
        {task.due_date && <span className="text-muted-foreground">{task.due_date}</span>}
      </div>
    </button>
  );
}
