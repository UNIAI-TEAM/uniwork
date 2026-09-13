"use client";

import {
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import type { Task } from "@uniwork/core/types";
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
  ContextMenuTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { toastApiError } from "../toast-api-error";
import {
  CONTEXT_PARTS,
  DROPDOWN_PARTS,
  RowActionItems,
  type RowActionModel,
  type TaskUpdates,
} from "./row-actions-items";
import { useTaskSurfaceActionsOptional } from "./surface/actions-context";

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
