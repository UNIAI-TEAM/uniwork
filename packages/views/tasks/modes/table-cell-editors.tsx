"use client";

import type { SyntheticEvent } from "react";
import { CalendarDays, Flag, FolderKanban, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskLabel,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import {
  useAttachTaskLabel,
  useDetachTaskLabel,
  useLabelsOnTask,
} from "@uniwork/core/tasks";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../common/date-field";
import { AgentBadge } from "../../agents/agent-badge";
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
    <div onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
              aria-label={t("tasks.status")}
            />
          }
        >
          <span className={cn("size-2 shrink-0 rounded-full bg-current", color)} />
          <span className="truncate">{t(`tasks.status_${value}`)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onChange(next as TaskStatus)}
          >
            {TASK_STATUSES.map((status) => (
              <DropdownMenuRadioItem key={status} value={status}>
                <span
                  className={cn(
                    "size-2 rounded-full bg-current",
                    STATUS_CONFIG[status].iconColor,
                  )}
                />
                {t(`tasks.status_${status}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
    <div onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
              aria-label={t("tasks.priority")}
            />
          }
        >
          <Flag
            className={cn("size-3.5 shrink-0", PRIORITY_COLOR[value])}
            aria-hidden
          />
          <span className="truncate">{t(`tasks.priority_${value}`)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => onChange(next as TaskPriority)}
          >
            {TASK_PRIORITIES.map((priority) => (
              <DropdownMenuRadioItem key={priority} value={priority}>
                <Flag
                  className={cn("size-3.5", PRIORITY_COLOR[priority])}
                  aria-hidden
                />
                {t(`tasks.priority_${priority}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  return (
    <div onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-full justify-start gap-1.5 px-1.5 font-normal"
              aria-label={t("tasks.assignee")}
            />
          }
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={assigneeId ?? "__none__"}
            onValueChange={(next) =>
              onChange(next === "__none__" ? null : next)
            }
          >
            <DropdownMenuRadioItem value="__none__">
              {t("tasks.unassigned")}
            </DropdownMenuRadioItem>
            {members.map((member) => (
              <DropdownMenuRadioItem key={member.id} value={member.id}>
                <MemberIdentity member={member} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  const attached = useLabelsOnTask(taskId);
  const attach = useAttachTaskLabel(workspaceId, taskId);
  const detach = useDetachTaskLabel(workspaceId, taskId);
  const selected = attached.data?.labels ?? [];
  const selectedIds = new Set(selected.map((label) => label.id));
  const pending = attach.isPending || detach.isPending;

  return (
    <div onClick={stopRowNavigation} onAuxClick={stopRowNavigation}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 max-w-full justify-start gap-1 px-1.5 font-normal"
              aria-label={t("tasks.detail.prop_labels")}
            />
          }
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
                  className="max-w-24 truncate rounded bg-secondary px-1.5 py-0.5 text-caption"
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
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-56 overflow-y-auto"
        >
          {labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={selectedIds.has(label.id)}
              disabled={pending}
              onCheckedChange={(checked) => {
                if (checked) attach.mutate(label.id);
                else detach.mutate(label.id);
              }}
            >
              <span className="truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {labels.length === 0 ? (
            <p className="px-2 py-4 text-center text-caption text-muted-foreground">
              {t("tasks.table.labels_empty")}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
