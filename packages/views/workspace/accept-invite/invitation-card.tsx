"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import { invitationWorkspaces, type InvitationPreview } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { ChangedNotice, RetryNotice, type RetryReason } from "./invite-notices";
import { LaterLink } from "./invite-screens";
import { OrgMark, RoleBadge } from "./org-mark";

type Invitation = InvitationPreview["invitation"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until the invitation expires, rounded up; null once past or unreadable. */
function daysLeft(expiresAt: string): number | null {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  const days = Math.ceil((at - Date.now()) / DAY_MS);
  return days > 0 ? days : null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <span className="shrink-0 text-caption text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-body font-medium text-foreground [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

/**
 * What accepting gives. The organization leads as an identity — its mark,
 * name and address — and the facts follow on a tinted plane: the workspace
 * if any, the role, who asked, and how long the invitation still holds.
 */
function InvitationDetails({ invitation, label }: { invitation: Invitation; label: string }) {
  const { t } = useTranslation();
  const days = daysLeft(invitation.expires_at);
  // Every workspace accepting grants (UNI-1582), so the person knows where they land.
  const workspaces = invitationWorkspaces(invitation).map((w) => w.name);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <OrgMark name={invitation.organization.name} tone="to" size="lg" />
        <div className="flex min-w-0 flex-col">
          <span className="text-title-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {invitation.organization.name}
          </span>
          <span className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">
            {appHost()}/{invitation.organization.slug}
          </span>
        </div>
      </div>
      <ul aria-label={label} className="flex flex-col divide-y divide-border/70 rounded-xl bg-muted/50 px-4 py-1">
        <Row label={t("invitations.preview.workspace")}>
          {workspaces.length > 0 ? (
            workspaces.join(", ")
          ) : (
            <span className="font-normal text-muted-foreground">{t("invitations.preview.no_workspace")}</span>
          )}
        </Row>
        <Row label={t("invitations.preview.role")}>
          <RoleBadge role={invitation.org_role} />
        </Row>
        {invitation.inviter_name ? <Row label={t("invitations.preview.inviter")}>{invitation.inviter_name}</Row> : null}
        {days ? (
          <Row label={t("invitations.preview.expiry")}>
            <span data-tabular>{t("invitations.preview.expires_in", { count: days })}</span>
          </Row>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * A pending invitation with nothing in the way: the person reads it, then
 * joins or puts it off. Opening the link never joins by itself. Renders
 * inside the page's AuthShell, titled "Tham gia {organization}".
 */
export function JoinInvitationBody({
  invitation,
  label,
  notice,
  pending,
  retry,
  onJoin,
}: {
  invitation: Invitation;
  /** The page's title, which names the details list. */
  label: string;
  /** The switch the person was in resolved itself (409 with no conflicts left). */
  notice: boolean;
  pending: boolean;
  /** Why the last attempt changed nothing and can be sent again; null when there was none. */
  retry: RetryReason | null;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      {notice ? <ChangedNotice /> : null}
      <InvitationDetails invitation={invitation} label={label} />
      <div className="flex flex-col gap-2">
        {retry ? <RetryNotice why={retry} /> : null}
        <Button
          type="button"
          size="lg"
          // While it is sent the button reads as working, not as unavailable.
          className={cn("w-full", pending && "aria-disabled:cursor-progress aria-disabled:opacity-100")}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={() => {
            if (!pending) onJoin();
          }}
        >
          {/* Decorative: the button's name stays "Tham gia". */}
          {pending ? <Spinner /> : null}
          {t("invitations.preview.join")}
        </Button>
        {/* Sent, the join cannot be called off; "Để sau" would hide that it went through. */}
        {pending ? null : <LaterLink />}
      </div>
    </div>
  );
}
