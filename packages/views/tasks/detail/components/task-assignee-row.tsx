"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import type { Task } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { AgentBadge } from "../../../agents/agent-badge";
import { PROP_ROW_TRIGGER_CLASS, PropRow } from "../../../common/prop-row";
import {
  AssigneePicker,
  useDecoratedAssigneeOptions,
  type AssigneeOption,
  type AssigneeRef,
} from "../../pickers";
import { TaskActorAvatar } from "./task-actor-avatar";

export function TaskAssigneeRow({
  workspaceId,
  task,
  onChange,
}: {
  workspaceId: string;
  task: Task;
  onChange: (patch: { assignee_id: string | null; assignee_kind: AssigneeRef["kind"] }) => void;
}) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const { data: agents } = useWorkspaceAgents(workspaceId);

  // Members, then agents (ADR 0007 pair: id + kind travel together); the
  // table's assignee cell builds the same list.
  const baseOptions: AssigneeOption[] = useMemo(
    () => [
      ...(members ?? []).map((m) => ({
        id: m.user_id,
        kind: "human" as const,
        name: m.display_name || m.email,
        secondaryLabel: m.email,
        ...(typeof m.avatar_url === "string" ? { avatarUrl: m.avatar_url } : {}),
      })),
      ...(agents ?? []).map((a) => ({
        id: a.id,
        kind: "agent" as const,
        name: a.name,
        ...(a.avatar_url ? { avatarUrl: a.avatar_url } : {}),
      })),
    ],
    [members, agents],
  );
  const options = useDecoratedAssigneeOptions(workspaceId, baseOptions);
  const value: AssigneeRef | null = task.assignee_id
    ? { id: task.assignee_id, kind: task.assignee_kind === "agent" ? "agent" : "human" }
    : null;
  const selected = value
    ? options.find((option) => option.id === value.id && option.kind === value.kind)
    : undefined;
  const name = selected?.name ?? task.assignee?.display_name;
  const avatarUrl = selected?.avatarUrl ?? task.assignee?.avatar_url;

  return (
    <PropRow
      label={
        <>
          {t("tasks.assignee")}
          {task.assignee?.kind === "agent" ? <AgentBadge /> : null}
        </>
      }
    >
      <AssigneePicker
        value={value}
        options={options}
        ariaLabel={t("tasks.assignee")}
        valueLabel={name ?? t("tasks.unassigned")}
        unassignedLabel={t("tasks.unassigned")}
        searchPlaceholder={t("tasks.assignee_search_placeholder")}
        noResultsLabel={t("tasks.assignee_no_results")}
        triggerClassName={PROP_ROW_TRIGGER_CLASS}
        onChange={(next) => {
          // Id and kind travel together (ADR 0007), as the table and row menu
          // send them.
          onChange(
            next
              ? { assignee_id: next.id, assignee_kind: next.kind }
              : { assignee_id: null, assignee_kind: "human" },
          );
        }}
      >
        {name ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <TaskActorAvatar name={name} avatarUrl={avatarUrl} kind={value?.kind} />
            <span className="truncate">{name}</span>
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{t("tasks.unassigned")}</span>
        )}
      </AssigneePicker>
    </PropRow>
  );
}
