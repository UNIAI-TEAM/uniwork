"use client";

import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";

/**
 * Where a task lives, from inside chat. Chat surfaces also mount outside the
 * workspace shell (isolated tests, previews), so every answer is optional:
 * without a workspace or a navigation adapter there is simply no link.
 */
export function useChatTaskNav(): {
  /** In-app path of a task, or null outside the workspace shell. */
  taskHref: (taskId: string) => string | null;
  /** The "Open" action for a toast about a task, or undefined when it cannot navigate. */
  openTaskAction: (taskId: string) => { label: string; onClick: () => void } | undefined;
  /** Can links be rendered as AppLink (a navigation adapter is present)? */
  canLink: boolean;
} {
  const { t } = useTranslation();
  const context = useOptionalWorkspace();
  const navigation = useOptionalNavigation();
  const workspace = context?.workspace;

  const taskHref = (taskId: string): string | null =>
    workspace && taskId ? paths.workspace(workspace.organization_slug, workspace.slug).task(taskId) : null;

  return {
    taskHref,
    openTaskAction: (taskId) => {
      const href = taskHref(taskId);
      if (!href || !navigation) return undefined;
      return { label: t("chat.task_open"), onClick: () => navigation.push(href) };
    },
    canLink: Boolean(workspace && navigation),
  };
}
