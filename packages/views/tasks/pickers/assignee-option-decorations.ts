import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceAgents } from "@uniwork/core/agents";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { canAssignAgent, type Decision } from "@uniwork/core/permissions";
import { useAssigneeFrequency } from "@uniwork/core/tasks";
import type { Agent, AssigneeFrequency } from "@uniwork/core/types";
import type { ActorAvatarStatus } from "@uniwork/ui/components/common/actor-avatar";
import type { AssigneeOption } from "./assignee-picker";

const frequencyKey = (kind: string, id: string) => `${kind}:${id}`;

/**
 * Most-picked first within each kind: members are ranked among the slots
 * members already hold, agents among theirs. The sort is stable, so ties
 * (never-picked included) keep the order the caller built.
 */
export function rankByFrequency(
  options: AssigneeOption[],
  frequency: readonly AssigneeFrequency[] | undefined,
): AssigneeOption[] {
  if (!frequency || frequency.length === 0) return options;
  const counts = new Map(
    frequency.map((entry) => [
      frequencyKey(entry.assignee_kind, entry.assignee_id),
      entry.frequency,
    ]),
  );
  const countOf = (option: AssigneeOption) =>
    counts.get(frequencyKey(option.kind, option.id)) ?? 0;
  const rankedByKind = new Map<string, AssigneeOption[]>();
  for (const kind of new Set(options.map((option) => option.kind))) {
    rankedByKind.set(
      kind,
      options
        .filter((option) => option.kind === kind)
        .map((option, index) => ({ option, index, count: countOf(option) }))
        .sort((a, b) => b.count - a.count || a.index - b.index)
        .map(({ option }) => option),
    );
  }
  const taken = new Map<string, number>();
  return options.map((option) => {
    const next = taken.get(option.kind) ?? 0;
    taken.set(option.kind, next + 1);
    return rankedByKind.get(option.kind)?.[next] ?? option;
  });
}

type UnassignableReason = Exclude<Decision["reason"], "allowed">;

/** Agents that cannot take new work stay listed, with the reason why. */
export function markUnassignableAgents(
  options: AssigneeOption[],
  agents: readonly Pick<Agent, "id" | "status">[] | undefined,
  reasonFor: (reason: UnassignableReason) => string,
): AssigneeOption[] {
  if (!agents || agents.length === 0) return options;
  const refused = new Map<string, UnassignableReason>();
  for (const agent of agents) {
    const decision = canAssignAgent(agent);
    if (!decision.allowed && decision.reason !== "allowed") refused.set(agent.id, decision.reason);
  }
  if (!options.some((option) => option.kind === "agent" && refused.has(option.id))) return options;
  return options.map((option) => {
    const reason = option.kind === "agent" ? refused.get(option.id) : undefined;
    return reason ? { ...option, disabledReason: reasonFor(reason) } : option;
  });
}

type AssigneeStatusLabels = Record<"online" | "agent_active" | "agent_paused" | "agent_archived", string>;

function agentStatus(status: string, labels: AssigneeStatusLabels): ActorAvatarStatus {
  switch (status) {
    case "active":
      return { tone: "success", label: labels.agent_active };
    case "archived":
      return { tone: "muted", label: labels.agent_archived };
    default:
      return { tone: "warning", label: labels.agent_paused };
  }
}

/** Members get a dot only while online; every known agent shows its lifecycle. */
export function withAssigneeStatus(
  options: AssigneeOption[],
  {
    isOnline,
    agents,
    labels,
  }: {
    isOnline: (userId: string) => boolean;
    agents: readonly Pick<Agent, "id" | "status">[] | undefined;
    labels: AssigneeStatusLabels;
  },
): AssigneeOption[] {
  const agentStatusById = new Map((agents ?? []).map((agent) => [agent.id, agent.status]));
  return options.map((option) => {
    if (option.kind === "human") {
      return isOnline(option.id) ? { ...option, status: { tone: "success", label: labels.online } } : option;
    }
    const status = agentStatusById.get(option.id);
    return status === undefined ? option : { ...option, status: agentStatus(status, labels) };
  });
}

/**
 * Everything the shared assignee picker shows beyond the raw member/agent list.
 * Every surface that builds its own options passes them through here, so the
 * pickers agree on order, on which agents can take new work, and on the
 * status dots.
 */
export function useDecoratedAssigneeOptions(
  workspaceId: string,
  options: AssigneeOption[],
): AssigneeOption[] {
  const { t } = useTranslation();
  const frequency = useAssigneeFrequency(workspaceId);
  const agents = useWorkspaceAgents(workspaceId);
  const onlineUserIds = usePresenceStore((state) => state.onlineUserIds);
  return useMemo(() => {
    const reasonFor = (reason: UnassignableReason) =>
      reason === "agent_archived"
        ? t("tasks.assignee_agent_archived")
        : t("tasks.assignee_agent_paused");
    const ranked = rankByFrequency(options, frequency.data);
    const marked = markUnassignableAgents(ranked, agents.data, reasonFor);
    return withAssigneeStatus(marked, {
      isOnline: (userId) => Boolean(onlineUserIds[normalizeTypingUserId(userId)]),
      agents: agents.data,
      labels: {
        online: t("tasks.assignee_status_online"),
        agent_active: t("tasks.assignee_status_agent_active"),
        agent_paused: t("tasks.assignee_status_agent_paused"),
        agent_archived: t("tasks.assignee_status_agent_archived"),
      },
    });
  }, [agents.data, frequency.data, onlineUserIds, options, t]);
}
