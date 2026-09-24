"use client";

import {
  useRef,
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

/**
 * One model per row. The context menu, the "more" dropdown and the delete
 * dialog all read the same instance, so there is one in-flight delete guard
 * per row: a delete confirmed from one entry point blocks a second confirm
 * from the other while the first request is still pending.
 */
export function useRowActionModel(
  task: Task,
  onOpenTask?: (id: string) => void,
): RowActionModel {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const workspaceContext = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Keeps the dialog mounted through its close transition; cleared by
  // `deleteDialogClosed` once Base UI reports the close finished.
  const [deleteDialogClosing, setDeleteDialogClosing] = useState(false);
  const deleteOpenRef = useRef(false);
  const changeDeleteOpen = (next: boolean) => {
    if (deleteOpenRef.current && !next) setDeleteDialogClosing(true);
    deleteOpenRef.current = next;
    setDeleteOpen(next);
  };

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

  // The confirm action is a plain button, not a close, so the dialog stays open
  // until the request settles. A ref guards it: a second click can land before
  // the `deleting` state re-renders.
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);

  // Delete goes through batchDelete: its mutation invalidates every list the
  // task can appear in, which the single-task hook does not.
  const confirmDelete = () => {
    if (!actions || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    void actions
      .batchDelete([task.id])
      .then(
        () => toast.success(t("tasks.row_actions.delete_success")),
        (error: unknown) =>
          toastApiError(error, t("tasks.row_actions.delete_failed")),
      )
      .finally(() => {
        deletingRef.current = false;
        setDeleting(false);
        changeDeleteOpen(false);
      });
  };

  return {
    task,
    open,
    copyLink,
    update,
    requestDelete: actions ? () => changeDeleteOpen(true) : undefined,
    hasAny: Boolean(open || copyLink || actions),
    deleteOpen,
    setDeleteOpen: changeDeleteOpen,
    deleting,
    confirmDelete,
    deleteDialogMounted: deleteOpen || deleting || deleteDialogClosing,
    deleteDialogClosed: () => setDeleteDialogClosing(false),
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

/**
 * The row's one delete dialog. Render it once per row, next to whichever
 * entry points the row has. It mounts only while open, closing, or while a
 * confirmed delete is in flight, so an idle row carries no dialog tree.
 */
export function RowDeleteDialog({ model }: { model: RowActionModel }) {
  if (!model.requestDelete || !model.deleteDialogMounted) return null;
  return (
    <RowEventBoundary className="contents">
      <DeleteTaskDialog model={model} />
    </RowEventBoundary>
  );
}

function DeleteTaskDialog({ model }: { model: RowActionModel }) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={model.deleteOpen}
      onOpenChange={model.setDeleteOpen}
      onOpenChangeComplete={(open) => {
        if (!open) model.deleteDialogClosed();
      }}
    >
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
          {/* Cancel and Escape stay live while deleting: the request cannot be
              aborted, but the user is not held in the dialog by a slow server. */}
          <AlertDialogAction
            onClick={model.confirmDelete}
            aria-disabled={model.deleting || undefined}
            className="bg-destructive-solid text-on-solid hover:bg-destructive-solid/90"
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
 * Wraps a row or card so a right click opens the row actions. Pass the row's
 * `useRowActionModel` and render `RowDeleteDialog` once inside it. The wrapper is
 * the row's own outer element (it takes the ref and style a sortable needs);
 * put drag listeners on a child, not here, so the menu is never inside them.
 */
export function RowActionsContextMenu({
  model,
  ref,
  style,
  className,
  children,
  ...dataAttributes
}: {
  model: RowActionModel;
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
} & DataAttributes) {
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
  model,
  className,
  triggerClassName,
}: {
  model: RowActionModel;
  className?: string;
  /** Hover/focus reveal classes bound to the host's group name. */
  triggerClassName?: string;
}) {
  const { t } = useTranslation();
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
    </RowEventBoundary>
  );
}
