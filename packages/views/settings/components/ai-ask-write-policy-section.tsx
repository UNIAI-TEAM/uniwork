"use client";

import { useTranslation } from "react-i18next";
import { useAskWritePolicy, useSetAskWritePolicy } from "@uniwork/core/ai/proposals";
import { useOrgMembership } from "@uniwork/core/organizations";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { SettingsCard, SettingsLoadError, SettingsRow, SettingsSection, SettingsSkeletonRows } from "./settings-layout";

const CEILINGS = ["off", "ask", "plan", "auto"] as const;
const ADMIN_ROLES = new Set(["owner", "admin"]);

/** The most Ask UNI may do on its own in this organization; the server clamps every member's mode to it. Read-only unless admin. */
export function AiAskWritePolicySection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.aiAccess" });
  const membership = useOrgMembership(orgSlug);
  const isAdmin = !!membership.data && ADMIN_ROLES.has(membership.data.role);
  const policy = useAskWritePolicy(orgSlug);
  const save = useSetAskWritePolicy(orgSlug);
  const locked = !isAdmin || save.isPending;

  let body;
  if (policy.isPending) body = <SettingsSkeletonRows rows={4} />;
  else if (!policy.data) {
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void policy.refetch()} />
      </SettingsCard>
    );
  } else {
    body = (
      <SettingsCard>
        <RadioGroup
          aria-label={t("askWriteTitle")}
          value={policy.data}
          onValueChange={(next) => {
            if (!locked && next !== policy.data) void save.mutateAsync(String(next)).catch(() => undefined);
          }}
        >
          {CEILINGS.map((c) => (
            <SettingsRow key={c} label={t(`askWriteCeiling.${c}`)} description={t(`askWriteCeilingNote.${c}`)}>
              <RadioGroupItem
                value={c}
                aria-label={t(`askWriteCeiling.${c}`)}
                aria-disabled={locked || undefined}
                className="aria-disabled:opacity-60"
              />
            </SettingsRow>
          ))}
        </RadioGroup>
      </SettingsCard>
    );
  }
  return (
    <SettingsSection title={t("askWriteTitle")} description={t("askWriteDescription")}>
      {body}
      {policy.data && !isAdmin ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t("askWriteReadOnly")}</p> : null}
      {save.isError ? <p role="alert" className="px-1 pt-2 text-caption text-destructive">{t("askModelsSaveFailed")}</p> : null}
    </SettingsSection>
  );
}
