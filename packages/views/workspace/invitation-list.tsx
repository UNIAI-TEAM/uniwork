"use client";
import { ChevronRight, CircleAlert, RefreshCw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { PendingInvitation } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { SettingsBadge } from "../settings/components/settings-layout";
import { roleLabel } from "./role-label";

/**
 * One frame for every state of the list — rows, skeleton, error — so the
 * column does not jump when the request settles. A hairline around real data
 * and nothing around the rest: the surrounding page is already the raised
 * object, a card per row would be a frame inside a frame.
 */
const FRAME = "flex flex-col divide-y divide-border rounded-lg border border-border";

/** An invitation this close to lapsing is flagged, so it is opened first. */
const SOON_MS = 48 * 60 * 60 * 1000;

function expiry(iso: string, locale: string): { date: string; soon: boolean } | null {
  const at = Date.parse(iso);
  if (!iso || Number.isNaN(at)) return null;
  const left = at - Date.now();
  return {
    date: new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }),
    soon: left > 0 && left < SOON_MS,
  };
}

/**
 * The invitations waiting for this address, each opening its own invite
 * page: joining has one flow wherever it starts (ADR 0032). The whole row is
 * the target — the trailing link stretches over it — while the link itself
 * stays a real anchor named after its destination, so a list of "Xem" reads
 * apart by ear and the global focus outline lands on something visible.
 *
 * `compact` is the same row at the chat sidebar's density (18–20rem wide):
 * tighter padding, the same lines in the same order, so an invitation reads
 * the same wherever it is listed.
 */
export function InvitationList({
  invitations,
  label,
  compact = false,
}: {
  invitations: PendingInvitation[];
  label: string;
  compact?: boolean;
}) {
  return (
    <ul aria-label={label} className={FRAME}>
      {invitations.map((invitation) => (
        <InvitationRow key={invitation.id} invitation={invitation} compact={compact} />
      ))}
    </ul>
  );
}

function InvitationRow({ invitation, compact }: { invitation: PendingInvitation; compact: boolean }) {
  const { t, i18n } = useTranslation();
  const organization = invitation.organization.name;
  const workspace = invitation.workspace?.name;
  // "›" is drawn, not read: a screen reader hears "Team trong Acme" instead
  // of the glyph's name, and the link's name says the same.
  const viewLabel = workspace
    ? t("invitations.viewWorkspaceLabel", { workspace, organization })
    : t("invitations.viewLabel", { name: organization });
  // An inviter whose name came back empty would leave " mời bạn vào".
  const inviter = invitation.invited_by.display_name.trim();
  const expires = expiry(invitation.expires_at, i18n.language);
  return (
    <li
      className={cn(
        "relative flex items-center gap-3 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg has-[a:hover]:bg-surface-hover has-[a:focus-visible]:bg-surface-hover pointer-coarse:min-h-11",
        compact ? "px-3 py-2.5" : "px-4 py-3",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Wraps instead of truncating: at 200% text a truncated line kept
            only the first letters of the inviter's name. */}
        <span className="text-pretty text-caption text-muted-foreground [overflow-wrap:anywhere]">
          {inviter ? t("invitations.invitedBy", { name: inviter }) : t("invitations.invited")}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-pretty text-body font-medium text-foreground [overflow-wrap:anywhere]">
            {workspace ? (
              <>
                <span aria-hidden>
                  {organization} › {workspace}
                </span>
                <span className="sr-only">{t("invitations.place", { workspace, organization })}</span>
              </>
            ) : (
              organization
            )}
          </span>
          {expires?.soon ? <SettingsBadge tone="warning">{t("invitations.expires_soon")}</SettingsBadge> : null}
        </span>
        {/* The separator rides on the role, and the date never breaks, so a
            narrow row wraps between the two instead of opening a line on "·". */}
        <span className="flex flex-wrap gap-x-1 text-caption text-muted-foreground">
          <span>
            {roleLabel(t, invitation.org_role)}
            {expires ? <span aria-hidden> ·</span> : null}
          </span>
          {expires ? (
            <span className="whitespace-nowrap">
              <Trans
                i18nKey="invitations.expires_on"
                values={{ date: expires.date }}
                components={{ time: <time dateTime={invitation.expires_at} data-tabular /> }}
              />
            </span>
          ) : null}
        </span>
      </div>
      <AppLink
        href={paths.invite(invitation.token)}
        aria-label={viewLabel}
        className="inline-flex shrink-0 items-center gap-1 text-body font-medium text-foreground underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
      >
        {t("invitations.view")}
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
      </AppLink>
    </li>
  );
}

/**
 * The list's final shape while it loads (PRODUCT.md: a spinner is a failure
 * state). The shapes are decoration; the status line is what is announced.
 */
export function InvitationListSkeleton({ rows = 2 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div>
      <span role="status" className="sr-only">
        {t("common.loading")}
      </span>
      <div aria-hidden className={FRAME}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A failed fetch says so where the list would be, in the list's frame, with a
 * retry that shows it is working. Never an empty state: "no invitations"
 * would be a claim the screen cannot make.
 */
export function InvitationListError({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 text-body">
      <CircleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 text-pretty text-foreground">{t("invitations.load_error")}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={onRetry}
      >
        {busy ? <Spinner className="size-3.5" /> : <RefreshCw aria-hidden className="size-3.5" />}
        {t("common.retry")}
      </Button>
    </div>
  );
}
