"use client";

import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { CapabilityDisabledControl } from "../common/capability-disabled-control";
import {
  CollectionPageHeader,
  CollectionPageState,
} from "../layout/collection-page";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/**
 * Agent runtime shell. List stays empty and create stays capability-gated —
 * no daemon / runtime mutation in this slice.
 */
export function RuntimesListPage() {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.agent_runs");
  const reason = t(cap.explanation_key || "capabilities.agent_runtime_missing");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={Cpu}
        title={t("runtimes.page.title")}
        count={0}
        actions={
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("runtimes.page.new_runtime")}
            testId="runtimes-create-stub"
          />
        }
      />
      <CollectionPageState
        icon={Cpu}
        title={t("runtimes.page.empty")}
        description={reason}
        role="status"
        actions={
          <CapabilityDisabledControl
            capabilityKey="tasks.agent_runs"
            label={t("runtimes.page.create_first")}
            testId="runtimes-create-first-stub"
          />
        }
      />
    </div>
  );
}
