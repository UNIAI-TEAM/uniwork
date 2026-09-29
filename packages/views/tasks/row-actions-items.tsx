"use client";

import type { ComponentType, ReactNode } from "react";
import {
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
import { useStatusOptions } from "./pickers";

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
  /** Open, closing, or deleting: the only times the row mounts its dialog. */
  deleteDialogMounted: boolean;
  /** Called when the dialog's close transition has finished. */
  deleteDialogClosed: () => void;
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

export function RowActionItems({
  parts: P,
  model,
  onOpenAssignee,
}: {
  parts: MenuParts;
  model: RowActionModel;
  /** Opens the shared assignee picker after this menu closes. */
  onOpenAssignee: () => void;
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
          {/* Closes this menu and hands off to the shared assignee picker
              (search, members and agents), the same one every other
              assignee field uses. */}
          <P.Item onClick={onOpenAssignee}>
            <UserRound aria-hidden />
            {t("tasks.row_actions.change_assignee")}
          </P.Item>
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
