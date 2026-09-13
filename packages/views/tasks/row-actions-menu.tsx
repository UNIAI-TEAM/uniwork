"use client";

import {
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import {
  CircleDot,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import type { Task, TaskStatus } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { toastApiError } from "../toast-api-error";
import { StatusIcon } from "./modes/status-pill";
import { useStatusOptions, useWorkspaceAssigneeOptions } from "./pickers";
import { useTaskSurfaceActionsOptional } from "./surface/actions-context";

/**
 * The context menu and the dropdown are two Base UI namespaces with the same
 * shape. Items are written once against this map and rendered through either.
 */
type MenuParts = {
  Item: ComponentType<{
    onClick?: () => void;
    variant?: "default" | "destructive";
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
    children: ReactNode;
  }>;
};

const CONTEXT_PARTS: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
};

const DROPDOWN_PARTS: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
};

const UNASSIGNED = "__unassigned__";

type TaskUpdates = Record<string, unknown>;

type RowActionModel = {
  task: Task;
  /** Each action is undefined when there is nothing to run it with; it is then hidden. */
  open?: () => void;
  copyLink?: () => void;
  update?: (updates: TaskUpdates) => void;
  requestDelete?: () => void;
  hasAny: boolean;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
  confirmDelete: () => void;
};

function useRowActionModel(
  task: Task,
  onOpenTask?: (id: string) => void,
): RowActionModel {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const open = onOpenTask ? () => onOpenTask(task.id) : undefined;

  const copyLink = workspaceContext
    ? () => {
        const { workspace } = workspaceContext;
        const path = paths
          .workspace(workspace.organization_slug, workspace.slug)
          .task(task.id);
        void copyText(navigation?.getShareableUrl(path) ?? path).then((ok) => {
          if (ok) toast.success(t("tasks.row_actions.link_copied"));
          else toast.error(t("tasks.row_actions.copy_link_failed"));
        });
      }
    : undefined;

  const update = actions
    ? (updates: TaskUpdates) =>
        actions.updateTask(task.id, updates, {
          onError: (error) => toastApiError(error, t("common.error")),
        })
    : undefined;

  // Delete goes through batchDelete: its mutation invalidates every list the
  // task can appear in, which the single-task hook does not.
  const confirmDelete = () => {
    if (!actions) return;
    void actions
      .batchDelete([task.id])
      .then(
        () => toast.success(t("tasks.row_actions.delete_success")),
        (error: unknown) =>
          toastApiError(error, t("tasks.row_actions.delete_failed")),
      )
      .finally(() => setDeleteOpen(false));
  };

  return {
    task,
    open,
    copyLink,
    update,
    requestDelete: actions ? () => setDeleteOpen(true) : undefined,
    hasAny: Boolean(open || copyLink || actions),
    deleteOpen,
    setDeleteOpen,
    confirmDelete,
  };
}

function stopRowEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Menu popups and the delete dialog are portalled, but React bubbles their
 * events through the component tree anyway, and Base UI nests portals so one
 * click makes two passes. Rows and table rows open the task on click and
 * middle click, so both stop here on the first pass; the second never runs.
 * contextmenu stops too, so a right click inside the dropdown does not open
 * the row's context menu on top of it.
 */
function RowEventBoundary({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- event boundary only; the controls inside are interactive
    <div
      className={className}
      onClick={stopRowEvent}
      onAuxClick={stopRowEvent}
      onContextMenu={stopRowEvent}
    >
      {children}
    </div>
  );
}

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
  const options = useWorkspaceAssigneeOptions(task.workspace_id);
  const value = task.assignee_id
    ? `${task.assignee_kind === "agent" ? "agent" : "human"}:${task.assignee_id}`
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
      {options.map((option) => (
        <P.RadioItem
          key={`${option.kind}:${option.id}`}
          value={`${option.kind}:${option.id}`}
          closeOnClick
        >
          <span className="min-w-0 truncate">{option.name}</span>
        </P.RadioItem>
      ))}
    </P.RadioGroup>
  );
}

function RowActionItems({
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

function DeleteTaskDialog({ model }: { model: RowActionModel }) {
  const { t } = useTranslation();
  if (!model.requestDelete) return null;
  return (
    <AlertDialog open={model.deleteOpen} onOpenChange={model.setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tasks.row_actions.delete_dialog_title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks.row_actions.delete_dialog_desc", {
              title: model.task.title,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tasks.row_actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={model.confirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("tasks.row_actions.delete_confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type DataAttributes = { [key: `data-${string}`]: string | undefined };

/**
 * Wraps a row or card so a right click opens the row actions. The wrapper is
 * the row's own outer element (it takes the ref and style a sortable needs);
 * put drag listeners on a child, not here, so the menu is never inside them.
 */
export function RowActionsContextMenu({
  task,
  onOpenTask,
  ref,
  style,
  className,
  children,
  ...dataAttributes
}: {
  task: Task;
  onOpenTask?: (id: string) => void;
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
} & DataAttributes) {
  const model = useRowActionModel(task, onOpenTask);
  if (!model.hasAny) {
    return (
      <div ref={ref} style={style} className={className} {...dataAttributes}>
        {children}
      </div>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={ref}
        style={style}
        className={className}
        {...dataAttributes}
      >
        {children}
        <RowEventBoundary className="contents">
          <ContextMenuContent className="min-w-48">
            <RowActionItems parts={CONTEXT_PARTS} model={model} />
          </ContextMenuContent>
          <DeleteTaskDialog model={model} />
        </RowEventBoundary>
      </ContextMenuTrigger>
    </ContextMenu>
  );
}

/**
 * The same actions behind a "more" button, for keyboards and touch screens,
 * which have neither hover nor right click. It stays in the tab order while
 * hidden, shows on hover or focus, and always shows on coarse pointers.
 */
export function RowActionsDropdown({
  task,
  onOpenTask,
  className,
  triggerClassName,
}: {
  task: Task;
  onOpenTask?: (id: string) => void;
  className?: string;
  /** Hover/focus reveal classes bound to the host's group name. */
  triggerClassName?: string;
}) {
  const { t } = useTranslation();
  const model = useRowActionModel(task, onOpenTask);
  if (!model.hasAny) return null;
  return (
    <RowEventBoundary className={cn("flex shrink-0 items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("tasks.surface.more_actions")}
              className={cn(
                "text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100",
                triggerClassName,
              )}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <RowActionItems parts={DROPDOWN_PARTS} model={model} />
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteTaskDialog model={model} />
    </RowEventBoundary>
  );
}
