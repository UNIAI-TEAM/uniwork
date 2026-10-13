"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import type { InvitationPreview } from "@uniwork/core/types";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { AuthShell } from "../../auth/auth-shell";
import { LaterLink } from "./invite-screens";
import { roleLabel } from "./switch-draft";

type Invitation = InvitationPreview["invitation"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 text-caption text-muted-foreground sm:w-28">{label}</span>
      <span className="min-w-0 text-body text-foreground [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

/** What accepting gives: the organization, the workspace if any, the role, who asked. */
function InvitationDetails({ invitation, label }: { invitation: Invitation; label: string }) {
  const { t } = useTranslation();
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
      <Row label={t("invitations.preview.organization")}>
        <span className="block font-medium">{invitation.organization.name}</span>
        <span className="block font-mono text-caption text-muted-foreground">
          {appHost()}/{invitation.organization.slug}
        </span>
      </Row>
      <Row label={t("invitations.preview.workspace")}>
        {invitation.workspace ? (
          <span className="font-medium">{invitation.workspace.name}</span>
        ) : (
          <span className="text-muted-foreground">{t("invitations.preview.no_workspace")}</span>
        )}
      </Row>
      <Row label={t("invitations.preview.role")}>{roleLabel(t, invitation.org_role)}</Row>
      {invitation.inviter_name ? <Row label={t("invitations.preview.inviter")}>{invitation.inviter_name}</Row> : null}
    </ul>
  );
}

/**
 * A pending invitation with nothing in the way: the person reads it, then
 * joins or puts it off. Opening the link never joins by itself.
 */
export function JoinInvitationScreen({
  invitation,
  notice,
  pending,
  busy,
  onJoin,
}: {
  invitation: Invitation;
  /** The switch the person was in resolved itself (409 with no conflicts left). */
  notice: boolean;
  pending: boolean;
  /** The server was busy with another change to this account; nothing changed. */
  busy: boolean;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  const title = t("invitations.preview.title", { name: invitation.organization.name });
  return (
    <AuthShell
      title={title}
      description={
        invitation.inviter_name
          ? t("invitations.preview.description_inviter", { inviter: invitation.inviter_name })
          : t("invitations.preview.description")
      }
    >
      <div className="flex flex-col gap-6">
        {notice ? (
          <Alert variant="warning">
            <AlertDescription>{t("invitations.switch.changed")}</AlertDescription>
          </Alert>
        ) : null}
        <InvitationDetails invitation={invitation} label={title} />
        {busy ? (
          <Alert variant="destructive">
            <AlertDescription>{t("invitations.switch.busy")}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            size="lg"
            className="w-full"
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => {
              if (!pending) onJoin();
            }}
          >
            {t("invitations.preview.join")}
          </Button>
          <LaterLink />
        </div>
      </div>
    </AuthShell>
  );
}
