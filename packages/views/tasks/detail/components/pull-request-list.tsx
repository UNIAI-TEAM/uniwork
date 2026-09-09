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
 * Task-detail linked-PR chrome. Capability `tasks.vcs` stays unavailable —
 * empty list + reason; link action never mutates. No fabricated PR rows.
 */
export function TaskPullRequestList({ taskId: _taskId }: { taskId?: string }) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.vcs");
  const reason = t(cap.explanation_key || "capabilities.vcs_provider_missing");

  return (
    <section
      className="space-y-2"
      data-testid="task-detail-pull-requests"
      aria-labelledby="task-detail-pull-requests-heading"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3
          id="task-detail-pull-requests-heading"
          className="text-caption font-medium text-foreground"
        >
          {t("tasks.detail.pullRequests.section")}
        </h3>
        <div className="ml-auto">
          <CapabilityDisabledControl
            capabilityKey="tasks.vcs"
            label={t("tasks.detail.pullRequests.link")}
            testId="task-detail-pr-stub"
          />
        </div>
      </div>
      <p className="text-caption text-muted-foreground">
        {t("tasks.detail.pullRequests.empty")}
      </p>
      <p className="text-caption text-muted-foreground">{reason}</p>
    </section>
  );
}
