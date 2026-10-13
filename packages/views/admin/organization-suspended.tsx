"use client";

import { useTranslation } from "react-i18next";
import { CirclePause } from "lucide-react";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";

/**
 * What a member sees when their organization is suspended: every org and
 * workspace route answers 403 organization_suspended, so the shell shows
 * this instead of the page. Reason-free by design — the reason is between
 * the platform and the owner, not on every member's screen. The way out is
 * /get-started (ADR 0032): a suspended organization still holds its members
 * (D1), so that page offers only the invitations — a member may leave a
 * suspended organization on the way into another, never found a second one.
 */
export function OrganizationSuspendedPage() {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.suspended" });
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <CollectionPageState
        icon={CirclePause}
        tone="warning"
        role="alert"
        title={t("title")}
        description={t("description")}
        actions={
          <AppLink href={paths.getStarted()} className={buttonVariants({ variant: "outline" })}>
            {t("get_started_link")}
          </AppLink>
        }
      />
    </div>
  );
}
