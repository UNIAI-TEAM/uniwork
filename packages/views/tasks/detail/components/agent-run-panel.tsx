"use client";

import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { CapabilityDisabledControl } from "../../../common/capability-disabled-control";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/**
 * Task-detail AgentRun chrome (execution-log geometry). Capability
 * `tasks.agent_runs` stays unavailable — history is empty + reason; start /
 * usage / retry / terminate never mutate. No fake successful runs.
 */
export function AgentRunPanel({ taskId: _taskId }: { taskId?: string }) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.agent_runs");
  const reason = t(
    cap.explanation_key || "capabilities.agent_runtime_missing",
  );

  return (
    <section
      className="space-y-2"
      data-testid="task-detail-agent-run-panel"
      aria-labelledby="task-detail-agent-run-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3
          id="task-detail-agent-run-heading"
          className="text-caption font-medium text-foreground"
        >
          {t("tasks.detail.agentRun.section")}
        </h3>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("tasks.detail.agentRun.usage")}
            testId="task-detail-agent-run-usage"
          />
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("tasks.detail.agentRun.retry")}
            testId="task-detail-agent-run-retry"
          />
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("tasks.detail.agentRun.terminate")}
            testId="task-detail-agent-run-terminate"
          />
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("tasks.detail.agentRun.start")}
            testId="task-detail-agent-run-stub"
          />
        </div>
      </div>
      <p className="text-caption text-muted-foreground">
        {t("tasks.detail.agentRun.empty")}
      </p>
      <p className="text-caption text-muted-foreground">{reason}</p>
    </section>
  );
}
