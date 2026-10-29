"use client";

import { lazy, Suspense, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import { useHomeWorkspace } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { PAGE_LEADING_ICON, PageHeader } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { SettingsTabSkeleton } from "./settings-layout";

// The same lazy chunk the workspace settings load: this route carries no more than it shows.
const SecurityTab = lazy(() => import("./security-tab").then((m) => ({ default: m.SecurityTab })));

/**
 * /settings, the account's own settings outside every workspace (spec §4.5):
 * where a mail's "Xem bảo mật", a link from Settings coming back, and the
 * UniChat shell's "Liên kết trên web" land. A person with a workspace is
 * sent on to its settings, the query kept whole (the tab, the result of a
 * link, expect_user); one without one — a new Google or Apple account still
 * on /get-started — gets the security tab here, which is all of the
 * account's settings that need no workspace.
 */
export function AccountSettingsView() {
  const { t } = useTranslation();
  const { status } = useSession();
  const nav = useNavigation();
  const home = useHomeWorkspace();
  const query = nav.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  useEffect(() => {
    if (status === "anon") nav.replace(paths.login({ next: `${paths.accountSettings()}${suffix}` }));
    else if (home) nav.replace(`${paths.workspace(home.organization_slug, home.slug).settings()}${suffix}`);
  }, [status, home, suffix, nav]);

  // Until it is known that this page stands on its own, the shape it would
  // have: the header and the tab's skeleton, never a blank screen.
  const ready = status === "authed" && home === null;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PageHeader
        leading={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={PAGE_LEADING_ICON}
            aria-label={t("common.back")}
            onClick={() => nav.push(paths.workspaces())}
          >
            <ArrowLeft aria-hidden className="size-4" />
          </Button>
        }
      >
        <h1 className="truncate text-body font-semibold">{t("settings.page.accountTitle")}</h1>
      </PageHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-12 sm:px-6 md:px-8 md:pt-8 md:pb-16">
        {ready ? (
          <Suspense fallback={<SettingsTabSkeleton />}>
            <SecurityTab />
          </Suspense>
        ) : (
          <SettingsTabSkeleton />
        )}
      </main>
    </div>
  );
}
