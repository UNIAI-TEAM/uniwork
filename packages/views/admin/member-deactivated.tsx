"use client";

import { useTranslation } from "react-i18next";
import { UserX } from "lucide-react";
import { paths } from "@uniwork/core/paths";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";
import { AppLink } from "../navigation";

/**
 * What somebody sees once their membership of this organization has been
 * switched off (F-03 §6.3): every organization and workspace route answers 403
 * member_deactivated, so the shell shows this instead of the page. A
 * deactivated membership no longer counts as belonging (ADR 0032 D1), so the
 * way out is /get-started: create an organization or join another one.
 */
export function MemberDeactivatedPage() {
  const { t } = useTranslation(undefined, { keyPrefix: "org.deactivated" });
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <CollectionPageState
        icon={UserX}
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
