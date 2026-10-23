"use client";

import { Check, CreditCard, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Entitlement } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../../layout/collection-page";
import { QuotaMeterRow } from "./quota-meter";
import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The server seeds feature names in its own words (migrations 069, 193), and
 * those drift from the glossary ("Số lượng task"). Known keys read from the
 * locale; a key this client has not been taught keeps the server's name.
 * Expects `t` scoped to `settings.billing`.
 */
export function featureLabel(t: Translate, featureKey: string, serverName: string): string {
  return t(`features.${featureKey.replaceAll(".", "_")}`, { defaultValue: serverName || featureKey });
}

/** Ceilings first: the rows that can run out are the ones worth reading. */
function byCeiling(a: Entitlement, b: Entitlement): number {
  return Number(a.quota_limit === null) - Number(b.quota_limit === null);
}

function FeatureList({ flags, label }: { flags: Entitlement[]; label: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  return (
    <SettingsCard>
      <ul aria-label={label} className="divide-y divide-border">
        {flags.map((e) => {
          const Icon = e.enabled ? Check : Lock;
          return (
            <li key={e.feature_key} className="flex min-h-11 items-center gap-2.5 px-4 py-2">
              <Icon aria-hidden className={cn("size-4 shrink-0", e.enabled ? "text-success" : "text-muted-foreground")} />
              <span className={cn("min-w-0 flex-1 truncate text-body", !e.enabled && "text-muted-foreground")}>
                {featureLabel(t, e.feature_key, e.name)}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {e.enabled ? t("flag_on") : t("flag_off")}
              </span>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

/**
 * What the plan allows and how much of it is used, split by kind: quotas
 * (a meter, or one line when there is no ceiling) and on/off features.
 */
export function BillingUsage({ entitlements }: { entitlements: Entitlement[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.billing" });
  // The server says which features something actually reads or writes.
  const visible = entitlements.filter((e) => e.metered);
  const quotas = visible.filter((e) => e.kind === "quota").sort(byCeiling);
  // Unknown kinds read as on/off: the lenient side of the wire contract.
  const flags = visible.filter((e) => e.kind !== "quota");

  if (visible.length === 0) {
    return (
      <SettingsSection title={t("usage_quotas")}>
        <CollectionPageState icon={CreditCard} title={t("no_entitlements")} role="status" headingLevel={3} />
      </SettingsSection>
    );
  }

  return (
    <>
      {quotas.length > 0 ? (
        <SettingsSection title={t("usage_quotas")} description={t("usage_quotas_description")}>
          <SettingsCard>
            {quotas.map((e) =>
              e.enabled ? (
                <QuotaMeterRow
                  key={e.feature_key}
                  label={featureLabel(t, e.feature_key, e.name)}
                  used={e.current_usage}
                  limit={e.quota_limit}
                  unit={e.unit}
                />
              ) : (
                <SettingsRow key={e.feature_key} label={featureLabel(t, e.feature_key, e.name)} size="none" className="min-h-12 py-2.5">
                  <span className="flex items-center gap-1.5 text-caption text-muted-foreground sm:justify-end">
                    <Lock aria-hidden className="size-3.5" />
                    {t("not_in_plan")}
                  </span>
                </SettingsRow>
              ),
            )}
          </SettingsCard>
        </SettingsSection>
      ) : null}
      {flags.length > 0 ? (
        <SettingsSection title={t("usage_features")} description={t("usage_features_description")}>
          <FeatureList flags={flags} label={t("usage_features")} />
        </SettingsSection>
      ) : null}
    </>
  );
}
