"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, Gauge } from "lucide-react";
import { useAdminOrganization, useAdminOrganizations } from "@uniwork/core/admin";
import { useFlag } from "@uniwork/core/feature-flags";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { PAGE_TOOLBAR } from "../layout/page-header";
import { EntitlementsTable } from "./organization-detail";

/**
 * /admin/quota — the entitlement snapshot of one organization. Hidden behind
 * `admin_quota` until the subscription spec ships the usage data (plan
 * decision 11).
 */
// ponytail: one org at a time; a "top organizations by usage" ranking needs a server-side query, not N detail calls.
export function AdminQuotaView() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.quota" });
  const enabled = useFlag("admin_quota", false);
  const [orgId, setOrgId] = useState("");
  const organizations = useAdminOrganizations({}, enabled);
  const detail = useAdminOrganization(enabled ? orgId : "");
  const items = (organizations.data ?? []).map((o) => ({ value: o.id, label: `${o.name} (${o.slug})` }));

  return (
    <>
      <CollectionPageHeader icon={Gauge} title={t("title")} description={t("description")} />
      {!enabled ? (
        <CollectionPageState icon={EyeOff} title={t("off_title")} description={t("off_description")} role="status" />
      ) : (
        <>
          <div className={PAGE_TOOLBAR}>
            <Select items={items} value={orgId} onValueChange={(next) => setOrgId(next ?? "")}>
              <SelectTrigger size="sm" className="w-full sm:max-w-sm" aria-label={t("pick_org")}>
                <SelectValue placeholder={t("pick_org")}>{items.find((i) => i.value === orgId)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!orgId ? (
            <CollectionPageState icon={Gauge} title={t("empty_title")} description={t("empty_description")} role="status" />
          ) : detail.isPending ? (
            <Skeleton className="m-4 h-40" />
          ) : (
            <EntitlementsTable entitlements={detail.data?.entitlements ?? []} />
          )}
        </>
      )}
    </>
  );
}
