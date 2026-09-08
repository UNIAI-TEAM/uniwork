"use client";

import { useState } from "react";
import { MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCreatePin,
  useDeletePin,
  useDeleteProject,
} from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";

export function ProjectRowActions({
  workspaceId,
  project,
  pinned,
  canDelete,
  onOpenProject,
}: {
  workspaceId: string;
  project: Project;
  pinned: boolean;
  canDelete: boolean;
  onOpenProject: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const createPin = useCreatePin(workspaceId);
  const deletePin = useDeletePin(workspaceId);
  const deleteProject = useDeleteProject(workspaceId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const togglePin = () => {
    if (pinned) {
      deletePin.mutate({ itemType: "project", itemId: project.id });
    } else {
      createPin.mutate({ item_type: "project", item_id: project.id });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={t("projects.page.row_menu")}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover/row:opacity-100 data-popup-open:bg-accent data-popup-open:opacity-100 data-popup-open:text-accent-foreground"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => onOpenProject(project.id)}>
            {t("projects.page.open")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={togglePin}>
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            {pinned ? t("projects.page.unpin") : t("projects.page.pin")}
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {t("projects.page.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.delete_dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("projects.delete_dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
            >
              {t("projects.delete_dialog.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteProject.mutate(project.id, {
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : String(err)),
                });
                setDeleteOpen(false);
              }}
            >
              {t("projects.delete_dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
