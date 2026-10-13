"use client";
import { CircleOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { holdsOrganization } from "@uniwork/core/types";
import { useHomeDestination } from "@uniwork/core/workspaces";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AuthShell } from "../../auth/auth-shell";
import { AppLink } from "../../navigation";

/**
 * "Để sau": leave the invitation where it is and go home. Nothing is sent;
 * the invitation keeps waiting in the list until it expires (spec D10).
 */
export function LaterLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  const home = useHomeDestination() ?? paths.workspaces();
  return (
    <AppLink href={home} className={cn(buttonVariants({ size: "lg", variant: "ghost" }), "w-full", className)}>
      {t("common.later")}
    </AppLink>
  );
}

/** Waiting on the session, the preview, or the accept itself. */
export function InviteLoadingScreen({ joining = false }: { joining?: boolean }) {
  const { t } = useTranslation();
  return (
    <AuthShell
      title={t(joining ? "workspace.acceptInviteJoining.title" : "invitations.title")}
      description={t("workspace.acceptInviteJoining.body")}
    >
      <p className="flex items-center gap-3 text-body text-muted-foreground" role="status" aria-live="polite">
        <Spinner className="size-5 shrink-0" />
        {t("common.loading")}
      </p>
    </AuthShell>
  );
}

export type GoneReason = "expired" | "revoked" | "accepted";

/** The 410 codes of the accept, and the preview's statuses, as one reason. */
export function goneReason(codeOrStatus: string | undefined): GoneReason | null {
  switch (codeOrStatus) {
    case "expired":
    case "invitation_expired":
      return "expired";
    case "revoked":
    case "invitation_revoked":
      return "revoked";
    case "accepted":
    case "invitation_accepted":
      return "accepted";
    default:
      return null;
  }
}

/**
 * The invitation admits nobody any more. Whatever the person had is
 * untouched — a switch that met this rolled back whole (AC-10, AC-11) — so the
 * page says where they still are.
 */
export function InvitationGoneScreen({ reason }: { reason: GoneReason }) {
  const { t } = useTranslation();
  const { data: organizations } = useOrganizations();
  const held = organizations?.find(holdsOrganization);
  return (
    <AuthShell title={t("invitations.gone.title")} description={t(`invitations.gone.${reason}`)}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2" role="alert">
          {held ? <p className="text-body font-medium text-foreground">{t("invitations.gone.still_in", { name: held.name })}</p> : null}
          <p className="flex items-start gap-3 text-body text-muted-foreground">
            <CircleOff aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t("workspace.acceptInviteError.hint")}
          </p>
        </div>
        <HomeLink />
      </div>
    </AuthShell>
  );
}

function HomeLink() {
  const { t } = useTranslation();
  const home = useHomeDestination() ?? paths.workspaces();
  return (
    <AppLink href={home} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
      {t("errors.back_home")}
    </AppLink>
  );
}
