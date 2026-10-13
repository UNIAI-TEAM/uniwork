"use client";
import { ChevronRight, CircleAlert, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { PendingInvitation } from "@uniwork/core/types";
import { useMyInvitations } from "@uniwork/core/workspaces";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AuthShell } from "../auth/auth-shell";
import { AppLink } from "../navigation";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";

const CARD = "flex flex-col gap-4 rounded-lg border border-border bg-surface p-5";

/**
 * /get-started: an onboarded person who belongs to no organization, after
 * leaving or closing theirs (ADR 0032 D12), or turned away by a deactivated
 * membership or a suspended organization. Two ways on: create an organization
 * (the new-workspace flow, which starts with the organization step), or open
 * one of the invitations waiting for this address. Each invitation goes
 * through its own page, so joining has one flow wherever it starts.
 */
export function NoOrganizationView() {
  const { t } = useTranslation(undefined, { keyPrefix: "onboarding.noOrganization" });
  return (
    <AuthShell title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <section aria-labelledby="get-started-create" className={CARD}>
          <div className="flex flex-col gap-1">
            <h2 id="get-started-create" className="text-title-sm font-semibold text-foreground">
              {t("create_title")}
            </h2>
            <p className="text-body text-muted-foreground">{t("create_body")}</p>
          </div>
          <AppLink href={paths.newWorkspace()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            {t("create_action")}
          </AppLink>
        </section>
        <section aria-labelledby="get-started-join" className={CARD}>
          <div className="flex flex-col gap-1">
            <h2 id="get-started-join" className="text-title-sm font-semibold text-foreground">
              {t("join_title")}
            </h2>
            <p className="text-body text-muted-foreground">{t("join_body")}</p>
          </div>
          <PendingInvitations />
        </section>
        <OnboardingLogoutButton className="self-center" />
      </div>
    </AuthShell>
  );
}

function PendingInvitations() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data: invitations, isLoading, isError, refetch, isRefetching } = useMyInvitations();

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner />
        {t("common.loading")}
      </p>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-body">
        <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 text-pretty text-foreground">
          {t("onboarding.noOrganization.load_error")}
        </span>
        <Button type="button" variant="outline" size="sm" aria-disabled={isRefetching || undefined} onClick={() => void refetch()}>
          <RefreshCw aria-hidden className="size-3.5" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (!invitations?.length) {
    return (
      <p className="text-body text-foreground">
        {t("onboarding.noOrganization.join_empty", { email: user?.email ?? "" })}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {invitations.map((invitation) => (
        <li key={invitation.id}>
          <InvitationLink invitation={invitation} />
        </li>
      ))}
    </ul>
  );
}

function InvitationLink({ invitation }: { invitation: PendingInvitation }) {
  const { t } = useTranslation();
  return (
    <AppLink
      href={paths.invite(invitation.token)}
      className="flex min-w-0 items-center gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:border-input hover:bg-muted/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption text-muted-foreground">
          {t("invitations.invitedBy", { name: invitation.invited_by.display_name })}
        </span>
        <span className="block truncate text-body font-medium text-foreground">
          {invitation.organization.name}
          {invitation.workspace ? ` › ${invitation.workspace.name}` : null}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </AppLink>
  );
}
