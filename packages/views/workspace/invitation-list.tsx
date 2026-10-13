"use client";
import { ChevronRight, CircleAlert, RefreshCw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { PendingInvitation } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
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
 */
export function InvitationList({ invitations, label }: { invitations: PendingInvitation[]; label: string }) {
  return (
    <ul aria-label={label} className={FRAME}>
      {invitations.map((invitation) => (
        <InvitationRow key={invitation.id} invitation={invitation} />
      ))}
    </ul>
  );
}

function InvitationRow({ invitation }: { invitation: PendingInvitation }) {
  const { t, i18n } = useTranslation();
  const name = invitation.workspace
    ? `${invitation.organization.name} › ${invitation.workspace.name}`
    : invitation.organization.name;
  const expires = expiry(invitation.expires_at, i18n.language);
  return (
    <li className="relative flex items-center gap-3 px-4 py-3 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg has-[a:hover]:bg-surface-hover has-[a:focus-visible]:bg-surface-hover pointer-coarse:min-h-11">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-caption text-muted-foreground">
          {t("invitations.invitedBy", { name: invitation.invited_by.display_name })}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-pretty text-body font-medium text-foreground [overflow-wrap:anywhere]">
            {name}
          </span>
          {expires?.soon ? <SettingsBadge tone="warning">{t("invitations.expires_soon")}</SettingsBadge> : null}
        </span>
        <span className="flex flex-wrap gap-x-1 text-caption text-muted-foreground">
          <span>{roleLabel(t, invitation.org_role)}</span>
          {expires ? (
            <span>
              <span aria-hidden>· </span>
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
        aria-label={t("invitations.viewLabel", { name })}
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
