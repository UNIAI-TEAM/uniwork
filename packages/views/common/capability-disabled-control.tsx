"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import type { WorkManagementCapability } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

type Props = {
  capabilityKey:
    | "tasks.agent_runs"
    | "tasks.squads"
    | "tasks.vcs"
    | "tasks.local_workdir"
    | WorkManagementCapability
    | string;
  children?: ReactNode;
  label: string;
  testId?: string;
};

/**
 * Capability-gated control for stub surfaces. Visible always; when the
 * capability is unavailable the button stays in tab order with aria-disabled
 * and a translated reason — never calls a mutation.
 */
export function CapabilityDisabledControl({
  capabilityKey,
  children,
  label,
  testId,
}: Props) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;

  const cap = capabilityState(config, capabilityKey as WorkManagementCapability);
  const disabled = cap.status !== "available";
  const reason = t(cap.explanation_key || "capabilities.unknown");
  const reasonId = testId ? `${testId}-reason` : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={testId}
        aria-disabled={disabled || undefined}
        title={disabled ? reason : undefined}
        aria-describedby={disabled && reasonId ? reasonId : undefined}
        onClick={() => {
          if (disabled) return;
          /* stub surfaces: mutation wiring lands in later slices */
        }}
      >
        {children ?? label}
      </Button>
      {disabled && reasonId ? (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      ) : null}
    </>
  );
}
