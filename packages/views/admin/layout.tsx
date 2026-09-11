"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { useAdminMe } from "@uniwork/core/admin";
import { ApiError } from "@uniwork/core/api";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { WorkspaceLoader } from "../layout/workspace-loader";
import { AppLink, useNavigation } from "../navigation";

const NAV = [
  { key: "overview", href: paths.admin.root() },
  { key: "organizations", href: paths.admin.organizations() },
  { key: "flags", href: paths.admin.flags() },
  { key: "trace", href: paths.admin.trace() },
  { key: "quota", href: paths.admin.quota() },
  { key: "system", href: paths.admin.system() },
] as const;

function isActive(pathname: string, href: string): boolean {
  // The console home is the only exact match; every other entry owns its subtree.
  if (href === paths.admin.root()) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shell of the /admin console: its own slim top nav, deliberately not the
 * workspace sidebar — the console sits outside every organization. The gate
 * is GET /admin/me: 404 means "no platform role" (the server does not admit
 * the route exists) and sends the visitor home; 401 sends them to login.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin" });
  const { pathname, replace } = useNavigation();
  const me = useAdminMe();
  const status = me.error instanceof ApiError ? me.error.status : 0;

  useEffect(() => {
    if (status === 404) replace(paths.root());
    if (status === 401) replace(`${paths.login()}?next=${encodeURIComponent(pathname)}`);
  }, [status, replace, pathname]);

  if (me.isPending || status === 404 || status === 401) return <WorkspaceLoader />;
  // A platform role without MFA is refused at the gate (F-01): say what to
  // turn on, and where, instead of a generic failure.
  if (me.error instanceof ApiError && me.error.code === "mfa_required") {
    return (
      <CollectionPageState
        icon={ShieldCheck}
        role="alert"
        title={t("guard.mfa_title")}
        description={t("guard.mfa_description")}
        actions={
          <AppLink href={paths.root()} className={buttonVariants({ variant: "outline" })}>
            {t("guard.mfa_action")}
          </AppLink>
        }
      />
    );
  }
  if (me.isError) {
    return (
      <CollectionPageState
        icon={AlertCircle}
        tone="destructive"
        role="alert"
        title={t("guard.error_title")}
        description={t("guard.error_description")}
        actions={
          <Button variant="outline" onClick={() => void me.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <span className="flex items-center gap-2 text-body font-medium">
          <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
          {t("title")}
          <span className="rounded-4xl bg-muted px-2 text-caption font-normal text-muted-foreground">{me.data}</span>
        </span>
        <nav aria-label={t("title")} className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <AppLink
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1 text-body transition-colors hover:bg-muted hover:text-foreground",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`nav.${item.key}`)}
              </AppLink>
            );
          })}
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
