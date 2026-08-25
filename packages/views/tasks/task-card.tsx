"use client";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import type { Task } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";

// Màu chỉ là signal: priority cao/khẩn mới có màu, còn lại grayscale.
const priorityClass: Record<Task["priority"], string> = {
  low: "text-tertiary",
  medium: "text-secondary",
  high: "text-warning",
  urgent: "text-danger",
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
        "block w-full rounded-[var(--uw-radius)] border border-line bg-surface p-2.5 text-left hover:border-line-strong",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="text-sm text-primary">{task.title}</div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <span className={priorityClass[task.priority]}>{t(`tasks.priority_${task.priority}`)}</span>
        {task.due_date && <span className="text-tertiary">{task.due_date}</span>}
      </div>
    </button>
  );
}
