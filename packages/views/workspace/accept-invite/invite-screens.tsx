"use client";
import { CircleCheck, Hourglass, Link2Off, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOrganizations } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { holdsOrganization } from "@uniwork/core/types";
import { useHomeDestination } from "@uniwork/core/workspaces";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_LINK } from "../../auth/login-view";
import { AppLink } from "../../navigation";
import { InviteNotice } from "./invite-notices";

/**
 * "Để sau": leave the invitation where it is and go home. Nothing is sent;
 * the invitation keeps waiting in the list until it expires (spec D10). A
 * quiet text link under the primary action, so it reads as the way out it
 * is rather than as a second choice of equal weight.
 */
export function LaterLink() {
  const { t } = useTranslation();
  const home = useHomeDestination() ?? paths.workspaces();
  return (
    <AppLink href={home} className={cn(AUTH_LINK, "justify-center self-center text-muted-foreground hover:text-foreground")}>
      {t("common.later")}
    </AppLink>
  );
}

/** "Xem lời mời của tôi": the other invitations still waiting, for a screen whose own invitation is spent. */
export function SeeInvitationsLink() {
  const { t } = useTranslation();
  return (
    <AppLink href={paths.invitations()} className={cn(AUTH_LINK, "justify-center self-center")}>
      {t("invitations.see_all")}
    </AppLink>
  );
}

/**
 * Reading the session and the invitation: the preview card's own shape in
 * skeleton, so the card fills in place instead of jumping from a spinner.
 */
export function InvitePreviewSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div aria-hidden className="flex flex-col gap-4 rounded-xl bg-muted/50 px-4 py-4">
        {["w-32", "w-24", "w-28"].map((width) => (
          <div key={width} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3 w-20 bg-background" />
            <Skeleton className={cn("h-4 bg-background", width)} />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-control pointer-coarse:h-11" />
        <Skeleton className="h-4 w-16 self-center" />
      </div>
    </div>
  );
}

/** The accept itself is under way: an action in progress, so the spinner is honest here. */
export function InviteJoining() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-3 text-body text-muted-foreground" role="status" aria-live="polite">
      <Spinner className="size-5 shrink-0" />
      {t("common.loading")}
    </p>
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

const GONE_ICON: Record<GoneReason, LucideIcon> = {
  expired: Hourglass,
  revoked: Link2Off,
  accepted: CircleCheck,
};

/**
 * The invitation admits nobody any more. Whatever the person had is
 * untouched — a switch that met this rolled back whole (AC-10, AC-11) — so the
 * page says where they still are, in the success tone: that is the news.
 */
export function InvitationGoneBody({ reason }: { reason: GoneReason }) {
  const { t } = useTranslation();
  const { data: organizations } = useOrganizations();
  const held = organizations?.find(holdsOrganization);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* A status: the organizations arrive after the heading has been
            announced, and this is the news, so it is said politely. */}
        {held ? (
          <Alert variant="success" role="status" className="rounded-xl p-4">
            <CircleCheck aria-hidden />
            <AlertDescription className="text-pretty font-medium">
              {t("invitations.gone.still_in", { name: held.name })}
            </AlertDescription>
          </Alert>
        ) : null}
        <InviteNotice icon={GONE_ICON[reason]} tone="muted">
          {t(`invitations.gone.hint_${reason}`)}
        </InviteNotice>
      </div>
      <div className="flex flex-col gap-2">
        <HomeLink />
        <SeeInvitationsLink />
      </div>
    </div>
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
