"use client";

import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/**
 * AgentRun + linked-PR chrome for task detail. Visible, never mutates runtime
 * (lát 6) — aria-disabled + capability reason only.
 */
export function TaskDetailRuntimeStubs() {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;

  const agentCap = capabilityState(config, "tasks.agent_runs");
  const vcsCap = capabilityState(config, "tasks.vcs");
  const agentDisabled = agentCap.status !== "available";
  const vcsDisabled = vcsCap.status !== "available";
  const agentReason = t(
    agentCap.explanation_key || "capabilities.agent_runtime_missing",
  );
  const vcsReason = t(
    vcsCap.explanation_key || "capabilities.vcs_provider_missing",
  );

  return (
    <div className="flex flex-wrap gap-2" data-testid="task-detail-runtime-stubs">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="task-detail-agent-run-stub"
        aria-disabled={agentDisabled || undefined}
        title={agentDisabled ? agentReason : undefined}
        aria-describedby={agentDisabled ? "task-detail-agent-run-reason" : undefined}
        onClick={() => {
          /* runtime mutation lands in lát 6 */
        }}
      >
        {t("tasks.detail.agent_run_stub")}
      </Button>
      {agentDisabled ? (
        <span id="task-detail-agent-run-reason" className="sr-only">
          {agentReason}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="task-detail-pr-stub"
        aria-disabled={vcsDisabled || undefined}
        title={vcsDisabled ? vcsReason : undefined}
        aria-describedby={vcsDisabled ? "task-detail-pr-reason" : undefined}
        onClick={() => {
          /* VCS / PR linking lands in lát 6 */
        }}
      >
        {t("tasks.detail.pr_stub")}
      </Button>
      {vcsDisabled ? (
        <span id="task-detail-pr-reason" className="sr-only">
          {vcsReason}
        </span>
      ) : null}
    </div>
  );
}
