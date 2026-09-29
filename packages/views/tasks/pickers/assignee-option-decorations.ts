import { useMemo } from "react";
import { useAssigneeFrequency } from "@uniwork/core/tasks";
import type { AssigneeFrequency } from "@uniwork/core/types";
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

/**
 * Everything the shared assignee picker shows beyond the raw member/agent list.
 * Every surface that builds its own options passes them through here, so the
 * pickers agree on order.
 */
export function useDecoratedAssigneeOptions(
  workspaceId: string,
  options: AssigneeOption[],
): AssigneeOption[] {
  const frequency = useAssigneeFrequency(workspaceId);
  return useMemo(
    () => rankByFrequency(options, frequency.data),
    [frequency.data, options],
  );
}
