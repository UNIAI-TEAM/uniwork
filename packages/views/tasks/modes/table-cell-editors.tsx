"use client";

import type { SyntheticEvent } from "react";
import { CalendarDays, Flag, FolderKanban, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type TaskLabel,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import { useLabelsOnTask } from "@uniwork/core/tasks";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../common/date-field";
import { AgentBadge } from "../../agents/agent-badge";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  labelChipClass,
  useTaskLabelToggle,
  type AssigneeOption,
  type AssigneeRef,
} from "../pickers";
import { STATUS_CONFIG } from "./status-config";

export type TableMember = {
  id: string;
  name: string;
  avatarUrl?: string;
};

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function TableStatusCell({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (value: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  const color = STATUS_CONFIG[value]?.iconColor ?? "text-muted-foreground";

  return (
    <StatusPicker
      value={value}
      onChange={onChange}
      ariaLabel={t("tasks.status")}
      onTriggerNavigationGuard={stopRowNavigation}
      triggerClassName="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
      icon={(status) => (
        <span
          className={cn(
            "size-2 rounded-full bg-current",
            STATUS_CONFIG[status].iconColor,
          )}
        />
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full bg-current", color)} />
      <span className="truncate">{t(`tasks.status_${value}`)}</span>
    </StatusPicker>
  );
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "text-destructive",
  high: "text-warning",
  medium: "text-info",
  low: "text-muted-foreground",
};

export function TablePriorityCell({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
}) {
  const { t } = useTranslation();
  return (
    <PriorityPicker
      value={value}
      onChange={onChange}
      ariaLabel={t("tasks.priority")}
      onTriggerNavigationGuard={stopRowNavigation}
      triggerClassName="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
      icon={(priority) => (
        <Flag className={cn("size-3.5", PRIORITY_COLOR[priority])} aria-hidden />
      )}
    >
      <Flag
        className={cn("size-3.5 shrink-0", PRIORITY_COLOR[value])}
        aria-hidden
      />
      <span className="truncate">{t(`tasks.priority_${value}`)}</span>
    </PriorityPicker>
  );
}

function MemberIdentity({ member }: { member: TableMember }) {
  return (
    <>
      <Avatar size="sm" className="size-5">
        {member.avatarUrl ? (
          <AvatarImage src={member.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback>{initials(member.name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{member.name}</span>
    </>
  );
}

export function TableAssigneeCell({
  assigneeId,
  assigneeName,
  assigneeKind,
  members,
  onChange,
}: {
  assigneeId?: string;
  assigneeName?: string;
  assigneeKind?: string;
  members: TableMember[];
  onChange: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const selected = members.find((member) => member.id === assigneeId);
  // Table only ever offers human members (no agent assignment here — see
  // assignee-picker.tsx and the task-2 report for why that stays as-is).
  const options: AssigneeOption[] = members.map((member) => ({
    id: member.id,
    kind: "human",
    name: member.name,
    avatarUrl: member.avatarUrl,
  }));
  const value: AssigneeRef | null = assigneeId
    ? { id: assigneeId, kind: assigneeKind === "agent" ? "agent" : "human" }
    : null;
  return (
    <AssigneePicker
      value={value}
      options={options}
      onChange={(next) => onChange(next?.id ?? null)}
      ariaLabel={t("tasks.assignee")}
      unassignedLabel={t("tasks.unassigned")}
      searchPlaceholder={t("tasks.assignee_search_placeholder")}
      noResultsLabel={t("tasks.assignee_no_results")}
      onTriggerNavigationGuard={stopRowNavigation}
      triggerClassName="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
    >
      {selected ? (
        <MemberIdentity member={selected} />
      ) : (
        <>
          <Avatar size="sm" className="size-5">
            <AvatarFallback>
              <UserRound className="size-3" aria-hidden />
            </AvatarFallback>
          </Avatar>
          <span className="truncate">
            {assigneeName ?? t("tasks.unassigned")}
          </span>
        </>
      )}
      {assigneeKind === "agent" ? <AgentBadge /> : null}
    </AssigneePicker>
  );
}

export function TableDueDateCell({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | null) => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stops row nav; child control is interactive
    <div onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
      <DateField
        value={value ?? ""}
        onChange={(next) => onChange(next || null)}
        className="h-7 border-0 bg-transparent px-1.5 text-caption shadow-none hover:bg-accent dark:bg-transparent"
      />
    </div>
  );
}

export function TableProjectCell({ title }: { title?: string }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-caption">
      <FolderKanban
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="truncate">
        {title ?? t("tasks.detail.prop_project_none")}
      </span>
    </span>
  );
}

export function TableLabelsCell({
  workspaceId,
  taskId,
  labels,
}: {
  workspaceId: string;
  taskId: string;
  labels: TaskLabel[];
}) {
  const { t } = useTranslation();
  // One per-row query, unchanged from before this picker existed; the
  // workspace catalog still arrives through `labels` (see task-4 brief).
  const attached = useLabelsOnTask(taskId);
  const { toggle, pendingIds } = useTaskLabelToggle(workspaceId, taskId);
  const selected = attached.data?.labels ?? [];
  const selectedIds = new Set(selected.map((label) => label.id));

  return (
    <LabelPicker
      labels={labels}
      selectedIds={selectedIds}
      pendingIds={pendingIds}
      onToggle={toggle}
      ariaLabel={t("tasks.detail.prop_labels")}
      emptyLabel={t("tasks.table.labels_empty")}
      onTriggerNavigationGuard={stopRowNavigation}
      triggerClassName="h-7 max-w-full justify-start gap-1 px-1.5 font-normal"
    >
      {selected.length === 0 ? (
        <span className="text-muted-foreground">
          {t("tasks.table.empty_value")}
        </span>
      ) : (
        <>
          {selected.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className={cn(
                "max-w-24 truncate rounded px-1.5 py-0.5 text-caption",
                labelChipClass(label.color),
              )}
            >
              {label.name}
            </span>
          ))}
          {selected.length > 2 ? (
            <span className="tabular-nums text-muted-foreground">
              +{selected.length - 2}
            </span>
          ) : null}
        </>
      )}
    </LabelPicker>
  );
}

export function TableProgressCell({
  done,
  total,
}: {
  done?: number;
  total?: number;
}) {
  const { t } = useTranslation();
  if (!total) {
    return (
      <span className="text-muted-foreground">
        {t("tasks.table.empty_value")}
      </span>
    );
  }
  const percent = Math.round(((done ?? 0) / total) * 100);
  return (
    <span className="flex min-w-0 items-center gap-2 text-caption">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-success"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="tabular-nums text-muted-foreground">
        {`${done ?? 0}/${total}`}
      </span>
    </span>
  );
}

export function TableDateText({ value }: { value?: string }) {
  const { i18n, t } = useTranslation();
  if (!value) {
    return (
      <span className="text-muted-foreground">
        {t("tasks.table.empty_value")}
      </span>
    );
  }
  const date = new Date(value);
  const label = Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <CalendarDays className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
