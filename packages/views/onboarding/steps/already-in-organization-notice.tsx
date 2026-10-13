"use client";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { alreadyInOrganization } from "@uniwork/core/organizations/errors";
import { paths } from "@uniwork/core/paths";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { STEP_HINT_ID } from "../components/step-shell";

export type HeldOrganization = ReturnType<typeof alreadyInOrganization>;

/**
 * Where "Manage organization" leads: that organization's settings in the first
 * of its workspaces the person can open; with none, the new-workspace flow,
 * which creates one inside it. `ready` stays false until the workspace list
 * has answered, so the caller can hold the link's place instead of guessing.
 * Called only by components mounted when the link is needed, so the create
 * path never reads the workspace list.
 */
function useOrganizationSettingsHref(organization: { id: string } | null | undefined): {
  href: string;
  /** The organization has a workspace to open its settings in. */
  inWorkspace: boolean;
  ready: boolean;
} {
  const { data: workspaces, isFetched, isError } = useWorkspaces();
  const first = organization ? workspaces?.find((w) => w.organization_id === organization.id) : undefined;
  return {
    href: first
      ? `${paths.workspace(first.organization_slug, first.slug).settings()}?tab=organization`
      : paths.newWorkspace(),
    inWorkspace: Boolean(first),
    ready: isFetched || isError,
  };
}

/**
 * FR-02: the account already belongs to an organization, so creating another
 * is refused. A rule, not a failure: a warning with a title that names the
 * organization and one sentence on the way out. The way out itself is the
 * step's primary action in the footer, not a second button in here.
 */
export function AlreadyInOrganizationNotice({ organization }: { organization: HeldOrganization }) {
  const { t } = useTranslation();
  return (
    <Alert variant="warning" className="gap-1 px-4 py-3">
      <TriangleAlert aria-hidden />
      <AlertTitle className="text-body font-semibold text-balance">
        {organization
          ? t("onboarding.step_organization.already_member_title", { name: organization.name })
          : t("onboarding.step_organization.already_member_title_unnamed")}
      </AlertTitle>
      <AlertDescription className="text-pretty">
        {t("onboarding.step_organization.already_member_body")}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The refused step's primary action, in the footer where the create CTA was.
 * Holds the link's place while the workspace list answers, so it does not push
 * in under a reader who just heard the notice.
 */
export function ManageOrganizationAction({ organization, label }: { organization: HeldOrganization; label: string }) {
  const settings = useOrganizationSettingsHref(organization);
  if (!settings.ready) return <Skeleton aria-hidden className="h-11 w-full rounded-control" />;
  return (
    <AppLink
      href={settings.href}
      aria-describedby={STEP_HINT_ID}
      className={buttonVariants({ size: "lg", className: "w-full" })}
    >
      {label}
    </AppLink>
  );
}

/**
 * Under a one-card picker: why there is no second card, and where a different
 * organization starts. Tertiary, and only where it leads somewhere real — the
 * settings of a workspace in that organization.
 */
export function OtherOrganizationLine({ organization }: { organization: { id: string; name: string } }) {
  const { t } = useTranslation();
  const settings = useOrganizationSettingsHref(organization);
  if (!settings.inWorkspace) return null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <p className="text-pretty text-caption text-muted-foreground">
        {t("onboarding.step_organization.resume_other_org", { name: organization.name })}
      </p>
      <AppLink
        href={settings.href}
        // cn, not cva's className: only tailwind-merge lets px-0 beat the
        // size's own padding, which otherwise indents the link off the text.
        className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto px-0")}
      >
        {t("onboarding.step_organization.manage_organization")}
      </AppLink>
    </div>
  );
}
