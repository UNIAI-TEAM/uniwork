"use client";

import { UsersRound } from "lucide-react";
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
 * Squad directory shell. List stays empty and create stays capability-gated —
 * no agent directory / mutation in this slice.
 */
export function SquadsListPage() {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const cap = capabilityState(config, "tasks.squads");
  const reason = t(cap.explanation_key || "capabilities.squad_directory_missing");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={UsersRound}
        title={t("squads.page.title")}
        count={0}
        actions={
          <CapabilityDisabledControl
            capabilityKey="tasks.squads"
            label={t("squads.page.new_squad")}
            testId="squads-create-stub"
          />
        }
      />
      <CollectionPageState
        icon={UsersRound}
        title={t("squads.page.empty")}
        description={reason}
        role="status"
        actions={
          <CapabilityDisabledControl
            capabilityKey="tasks.squads"
            label={t("squads.page.create_first")}
            testId="squads-create-first-stub"
          />
        }
      />
    </div>
  );
}
