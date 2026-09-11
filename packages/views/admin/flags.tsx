"use client";

import { useTranslation } from "react-i18next";
import { AlertCircle, Flag } from "lucide-react";
import { useAdminFlags, useAllFlagOverrides } from "@uniwork/core/admin";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@uniwork/ui/components/ui/table";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import { FlagOverrideRow } from "./flag-override-row";

/** /admin/flags — the catalogue with a global override switch per key. */
export function AdminFlagsView() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.flags" });
  const flags = useAdminFlags();
  const overrides = useAllFlagOverrides();
  return (
    <>
      <CollectionPageHeader icon={Flag} title={t("title")} count={flags.data?.length} description={t("description")} />
      {flags.isPending || overrides.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : flags.isError ? (
        <CollectionPageState
          icon={AlertCircle}
          tone="destructive"
          role="alert"
          title={t("error_title")}
          description={t("error_description")}
          actions={
            <Button variant="outline" onClick={() => void flags.refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : flags.data.length === 0 ? (
        <CollectionPageState icon={Flag} title={t("empty_title")} description={t("empty_description")} role="status" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.key")}</TableHead>
              <TableHead>{t("col.description")}</TableHead>
              <TableHead>{t("col.default")}</TableHead>
              <TableHead>{t("col.public")}</TableHead>
              <TableHead>{t("col.review_at")}</TableHead>
              <TableHead className="text-right">{t("col.overrides")}</TableHead>
              <TableHead>{t("col.global")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.data.map((flag) => (
              <FlagOverrideRow key={flag.key} flag={flag} scopeType="global" overrides={overrides.data ?? []} full />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
