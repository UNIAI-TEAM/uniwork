"use client";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths, resolvePostAuthDestination } from "@uniwork/core/paths";
import { holdsOrganization } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AuthShell } from "../auth/auth-shell";
import { AppLink, useNavigation } from "../navigation";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";

/**
 * /no-workspace (UNI-1472, UNI-1582): somebody who belongs to an organization
 * but has no workspace in it to open - typically a member whose invitation
 * granted none. They are told where they are and who can let them in, and are
 * never put through creating an organization or a workspace. Organization
 * and workspace access are separate: joining the organization opens none of
 * its workspaces by itself.
 *
 * The owner or an admin who ends up here (an organization with no workspace
 * at all) is offered to create the first one. "Kiểm tra lại" reads the
 * workspace list again; once a workspace is there, or the organization is
 * gone, the page sends the person where the entry gates would.
 */
export function NoWorkspaceView({ pending = false }: { pending?: boolean } = {}) {
  const { t } = useTranslation(undefined, { keyPrefix: "onboarding.noWorkspace" });
  const { user } = useSession();
  const { replace } = useNavigation();
  const organizations = useOrganizations(!pending);
  const workspaces = useWorkspaces(!pending);
  // The list was read again on request and still has nothing: say so, rather
  // than letting a press look like it did nothing.
  const [checked, setChecked] = useState(false);
  const held = organizations.data?.find(holdsOrganization);
  const runs = held?.role === "owner" || held?.role === "admin";

  const settled = organizations.data && workspaces.data ? resolvePostAuthDestination(workspaces.data, user, organizations.data) : null;
  // Only a workspace to land in, or no organization at all, moves the person
  // on; the owner or an admin stays here, where creating is offered.
  const leave = settled && settled !== paths.newWorkspace() && settled !== paths.noWorkspace() ? settled : null;
  useEffect(() => {
    if (leave) replace(leave);
  }, [leave, replace]);

  const check = () => {
    setChecked(false);
    void workspaces.refetch().then(() => setChecked(true));
  };
  const checking = workspaces.isFetching;

  return (
    <AuthShell
      title={pending || !held || leave ? undefined : t("title")}
      description={held ? t(runs ? "description_admin" : "description", { name: held.name }) : undefined}
    >
      {held && !leave ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-4 py-3">
            <p className="text-pretty text-body text-foreground">
              {runs ? t("create_body") : t("ask_body", { name: held.name })}
            </p>
            <p className="text-pretty text-body text-muted-foreground [overflow-wrap:anywhere]">
              <Trans
                t={t}
                i18nKey="account"
                values={{ email: user?.email ?? "" }}
                components={{ email: <span className="font-medium text-foreground" /> }}
              />
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {runs ? (
              <AppLink href={paths.newWorkspace()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
                {t("create_action")}
              </AppLink>
            ) : null}
            <Button
              type="button"
              variant={runs ? "outline" : "default"}
              size="lg"
              className="w-full"
              aria-disabled={checking || undefined}
              aria-busy={checking || undefined}
              onClick={() => {
                if (!checking) check();
              }}
            >
              {checking ? <Spinner className="size-4" /> : <RefreshCw aria-hidden className="size-4" />}
              {t("check")}
            </Button>
            {/* Mounted while empty: a live region inserted with its first
                message is not reliably announced. */}
            <p role="status" className="text-center text-caption text-muted-foreground empty:hidden">
              {checked && !checking ? t("still_none") : null}
            </p>
          </div>
          <OnboardingLogoutButton className="self-start" />
        </div>
      ) : null}
    </AuthShell>
  );
}
