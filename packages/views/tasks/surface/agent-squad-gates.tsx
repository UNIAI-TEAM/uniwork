"use client";

import { useTranslation } from "react-i18next";
import { CapabilityDisabledControl } from "../../common/capability-disabled-control";

/**
 * Surface / batch / create stubs for agent trigger and squad assign.
 * Catalogue keys stay unavailable in this slice — controls never mutate.
 */
export function AgentTriggerStub({
  testId,
  label,
}: {
  testId?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <CapabilityDisabledControl
      capabilityKey="tasks.agent_runs"
      label={label ?? t("tasks.surface.agent_trigger")}
      testId={testId ?? "surface-agent-trigger"}
    />
  );
}

export function SquadAssignStub({
  testId,
  label,
}: {
  testId?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <CapabilityDisabledControl
      capabilityKey="tasks.squads"
      label={label ?? t("tasks.surface.squad_assign")}
      testId={testId ?? "surface-squad-assign"}
    />
  );
}
