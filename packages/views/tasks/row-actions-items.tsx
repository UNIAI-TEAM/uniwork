"use client";

import type { ComponentType, ReactNode } from "react";
import {
  Bot,
  CircleDot,
  ExternalLink,
  Link2,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Task, TaskStatus } from "@uniwork/core/types";
import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { StatusIcon } from "./modes/status-pill";
import { useStatusOptions, useWorkspaceAssigneeOptions } from "./pickers";

/**
 * The context menu and the dropdown are two Base UI namespaces with the same
 * shape. Items are written once against this map and rendered through either.
 */
type MenuParts = {
  Item: ComponentType<{
    onClick?: () => void;
    variant?: "default" | "destructive";
    disabled?: boolean;
    children: ReactNode;
  }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children: ReactNode }>;
  RadioGroup: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }>;
  RadioItem: ComponentType<{
    value: string;
    closeOnClick?: boolean;
    disabled?: boolean;
    children: ReactNode;
  }>;
};

export const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
};

export const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
};

const UNASSIGNED = "__unassigned__";

export type TaskUpdates = Record<string, unknown>;

export type RowActionModel = {
  task: Task;
  /** Each action is undefined when there is nothing to run it with; it is then hidden. */
  open?: () => void;
  copyLink?: () => void;
  update?: (updates: TaskUpdates) => void;
  requestDelete?: () => void;
  hasAny: boolean;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  /** True while a confirmed delete is in flight; the confirm action ignores clicks. */
  deleting: boolean;
  confirmDelete: () => void;
};

function StatusRadioItems({
  parts: P,
  value,
  onSelect,
}: {
  parts: MenuParts;
  value: TaskStatus;
  onSelect: (status: TaskStatus) => void;
}) {
  const options = useStatusOptions((status) => <StatusIcon status={status} />);
  return (
    <P.RadioGroup
      value={value}
      onValueChange={(next) => onSelect(next as TaskStatus)}
    >
      {options.map((option) => (
        <P.RadioItem key={option.value} value={option.value} closeOnClick>
          {option.icon}
          {option.label}
        </P.RadioItem>
      ))}
    </P.RadioGroup>
  );
}

function AssigneeRadioItems({
  parts: P,
  task,
  onSelect,
}: {
  parts: MenuParts;
  task: Task;
  onSelect: (updates: TaskUpdates) => void;
}) {
  const { t } = useTranslation();
  // Mounted only while the submenu is open, so rows do not each subscribe to members.
  const { options, isLoading, isError } = useWorkspaceAssigneeOptions(
    task.workspace_id,
  );
  const assignedToAgent = Boolean(task.assignee_id) && task.assignee_kind === "agent";
  const value = task.assignee_id
    ? `${assignedToAgent ? "agent" : "human"}:${task.assignee_id}`
    : UNASSIGNED;

  return (
    <P.RadioGroup
      value={value}
      onValueChange={(key) => {
        // ADR 0007: id and kind always travel together, unassign included.
        if (key === UNASSIGNED) {
          onSelect({ assignee_id: null, assignee_kind: "human" });
          return;
        }
        const option = options.find((o) => `${o.kind}:${o.id}` === key);
        if (option) {
          onSelect({ assignee_id: option.id, assignee_kind: option.kind });
        }
      }}
    >
      <P.RadioItem value={UNASSIGNED} closeOnClick>
        <UserRound aria-hidden />
        {t("tasks.unassigned")}
      </P.RadioItem>
      {assignedToAgent ? (
        // Agents are not offered here, but the current one must still be
        // visible and checked. ADR 0007: the name is the server-resolved actor.
        <P.RadioItem value={value} disabled>
          <Bot aria-hidden />
          <span className="min-w-0 truncate">
            {task.assignee?.display_name ||
              t("tasks.row_actions.agent_assignee")}
          </span>
        </P.RadioItem>
      ) : null}
      {isLoading ? (
        <P.Item disabled>{t("tasks.row_actions.assignees_loading")}</P.Item>
      ) : isError ? (
        <P.Item disabled>{t("tasks.row_actions.assignees_failed")}</P.Item>
      ) : (
        options.map((option) => (
          <P.RadioItem
            key={`${option.kind}:${option.id}`}
            value={`${option.kind}:${option.id}`}
            closeOnClick
          >
            <span className="min-w-0 truncate">{option.name}</span>
          </P.RadioItem>
        ))
      )}
    </P.RadioGroup>
  );
}

export function RowActionItems({
  parts: P,
  model,
}: {
  parts: MenuParts;
  model: RowActionModel;
}) {
  const { t } = useTranslation();
  const { task, update } = model;
  const hasNavigationItems = Boolean(model.open || model.copyLink);

  return (
    <>
      {model.open ? (
        <P.Item onClick={model.open}>
          <ExternalLink aria-hidden />
          {t("tasks.row_actions.open")}
        </P.Item>
      ) : null}
      {model.copyLink ? (
        <P.Item onClick={model.copyLink}>
          <Link2 aria-hidden />
          {t("tasks.row_actions.copy_link")}
        </P.Item>
      ) : null}
      {update ? (
        <>
          {hasNavigationItems ? <P.Separator /> : null}
          <P.Sub>
            <P.SubTrigger>
              <CircleDot aria-hidden />
              {t("tasks.row_actions.change_status")}
            </P.SubTrigger>
            <P.SubContent>
              <StatusRadioItems
                parts={P}
                value={task.status}
                onSelect={(status) => update({ status })}
              />
            </P.SubContent>
          </P.Sub>
          <P.Sub>
            <P.SubTrigger>
              <UserRound aria-hidden />
              {t("tasks.row_actions.change_assignee")}
            </P.SubTrigger>
            {/* Long member lists scroll; search in this submenu is later work. */}
            <P.SubContent className="max-h-72 w-56">
              <AssigneeRadioItems parts={P} task={task} onSelect={update} />
            </P.SubContent>
          </P.Sub>
        </>
      ) : null}
      {model.requestDelete ? (
        <>
          <P.Separator />
          <P.Item variant="destructive" onClick={model.requestDelete}>
            <Trash2 aria-hidden />
            {t("tasks.row_actions.delete")}
          </P.Item>
        </>
      ) : null}
    </>
  );
}
