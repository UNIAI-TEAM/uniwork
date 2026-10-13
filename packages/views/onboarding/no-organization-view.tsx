"use client";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { holdsOrganization } from "@uniwork/core/types";
import { useMyInvitations } from "@uniwork/core/workspaces";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { AuthShell } from "../auth/auth-shell";
import { AppLink } from "../navigation";
import { InvitationList, InvitationListError, InvitationListSkeleton } from "../workspace/invitation-list";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";

/**
 * /get-started: an onboarded person who belongs to no organization, after
 * leaving or closing theirs (ADR 0032 D12), or turned away by a deactivated
 * membership or a suspended organization. Two ways on: create an organization
 * (the new-workspace flow, which starts with the organization step), or open
 * one of the invitations waiting for this address. Each invitation goes
 * through its own page, so joining has one flow wherever it starts.
 *
 * The two paths are one composed choice on the shell's raised surface, not
 * two cards inside it: the only framed object is the invitation list, which
 * is real data. When an invitation is waiting, joining is the next step, so
 * it comes first and creating steps down to an outline button.
 *
 * A suspended organization still holds its members (ADR 0032 D1), and its
 * notice links here too: such a person is told so and is offered only the
 * invitations, since founding another organization would be refused.
 */
export function NoOrganizationView() {
  const { t } = useTranslation(undefined, { keyPrefix: "onboarding.noOrganization" });
  const { data: organizations, isLoading } = useOrganizations();
  // Same query as the list below, so this reads the cache: no second request.
  const { data: invitations } = useMyInvitations();
  const held = organizations?.find(holdsOrganization);
  const invited = (invitations?.length ?? 0) > 0;

  const join = (
    <PathSection key="join" id="get-started-join" title={t("join_title")} body={t("join_body")}>
      <PendingInvitations />
    </PathSection>
  );
  let create: ReactNode = null;
  if (isLoading) create = <CreateSkeleton key="create" />;
  else if (!held) {
    create = (
      <PathSection key="create" id="get-started-create" title={t("create_title")} body={t("create_body")}>
        <AppLink
          href={paths.newWorkspace()}
          className={cn(buttonVariants({ variant: invited ? "outline" : "default", size: "lg" }), "w-full")}
        >
          {t("create_action")}
        </AppLink>
      </PathSection>
    );
  }
  // Keyed so that when the invitations arrive the two paths swap places
  // instead of remounting: a reader's position and any focus inside survive.
  const choices = (invited ? [join, create] : [create, join]).filter(Boolean);
  const ordered = choices.flatMap((path, i) => (i === 0 ? [path] : [<Separator key="separator" />, path]));

  return (
    <AuthShell
      title={held ? t("held_title", { name: held.name }) : t("title")}
      description={held ? t("held_description") : t("description")}
    >
      <div className="flex flex-col gap-8">
        {ordered}
        <OnboardingLogoutButton className="self-start" />
      </div>
    </AuthShell>
  );
}

function PathSection({ id, title, body, children }: { id: string; title: string; body: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 id={id} className="text-balance text-title-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-pretty text-body text-muted-foreground">{body}</p>
      </div>
      {children}
    </section>
  );
}

/** The create path's final shape while the organization list loads, so nothing pops in above the join path. */
function CreateSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-11 w-full rounded-control" />
    </div>
  );
}

function PendingInvitations() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data: invitations, isLoading, isError, refetch, isRefetching } = useMyInvitations();

  if (isLoading) return <InvitationListSkeleton rows={2} />;
  if (isError) return <InvitationListError onRetry={() => void refetch()} busy={isRefetching} />;
  if (!invitations?.length) {
    // The address is the fact that matters: it is what an admin must invite.
    return (
      <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-body font-medium text-foreground">{t("onboarding.noOrganization.join_empty_title")}</p>
        <p className="text-pretty text-body text-muted-foreground [overflow-wrap:anywhere]">
          <Trans
            i18nKey="onboarding.noOrganization.join_empty_body"
            values={{ email: user?.email ?? "" }}
            components={{ email: <span className="font-medium text-foreground" /> }}
          />
        </p>
      </div>
    );
  }
  return <InvitationList invitations={invitations} label={t("onboarding.noOrganization.join_title")} />;
}
