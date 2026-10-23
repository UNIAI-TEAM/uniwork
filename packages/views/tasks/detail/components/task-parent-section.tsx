"use client";

import { Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useSetTaskParent, useTask } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { SidebarSection } from "../../../common/sidebar-section";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { toastApiError } from "../../../toast-api-error";
import { StatusOptionIcon, useStatusCatalog } from "../../pickers";

/** Parent link with an unlink button; absent while the task has no parent. */
export function TaskParentSection({
  workspaceId,
  task,
}: {
  workspaceId: string;
  task: Task;
}) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const parentId = task.parent_task_id ?? "";
  const { data: parent } = useTask(parentId);
  const setParent = useSetTaskParent(workspaceId);
  const { optionOf } = useStatusCatalog(workspaceId);
  if (!parentId || !parent) return null;

  const href = paths.workspace(workspace.organization_slug, workspace.slug).task(parent.id);
  return (
    <SidebarSection title={t("tasks.detail.section_parent")}>
      <div className="group flex min-h-8 items-center gap-1 rounded-md pr-1 pl-2 transition-colors hover:bg-accent/50">
        <AppLink
          href={href}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-foreground"
        >
          <StatusOptionIcon option={optionOf(parent.status)} className="size-3.5 shrink-0" />
          <span className="shrink-0 text-muted-foreground">
            {parent.identifier || parent.id}
          </span>
          <span className="truncate">{parent.title}</span>
        </AppLink>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          aria-label={t("tasks.detail.parent_remove")}
          aria-disabled={setParent.isPending || undefined}
          onClick={() => {
            if (setParent.isPending) return;
            setParent.mutate(
              { taskId: task.id, body: { parent_task_id: null } },
              { onError: (err) => toastApiError(err, t("common.error")) },
            );
          }}
        >
          <Unlink aria-hidden />
        </Button>
      </div>
    </SidebarSection>
  );
}
