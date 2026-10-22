"use client";
import { CircleAlert, Hourglass, Info, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import type { NewVersion } from "./use-releases";
import type { ReleaseChannel } from "./manifest";

/** Same boxes as the loaded page, so nothing moves when the manifest arrives. */
export function VersionsSkeleton() {
  const { t } = useTranslation();
  return <div className="ver-skeleton" aria-busy="true">
    <p className="ver-loading" role="status"><Spinner />{t("landing.office.versions.states.loading")}</p>
    <div className="ver-tabs-skeleton" aria-hidden>{[0, 1, 2].map((n) => <Skeleton key={n} className="ver-skeleton-tab" />)}</div>
    <div className="ver-card ver-latest ver-latest-skeleton" aria-hidden>
      <Skeleton className="ver-skeleton-line is-short" /><Skeleton className="ver-skeleton-title" />
      <div className="ver-latest-body">
        <div className="ver-skeleton-rows">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="ver-skeleton-row" />)}</div>
        <div className="ver-skeleton-rows">{[0, 1, 2, 3, 4].map((n) => <Skeleton key={n} className="ver-skeleton-line" />)}</div>
      </div>
    </div>
  </div>;
}

/** A channel the manifest has never published (stable, today). */
export function ComingSoon({ channel, alternative, onChoose }: { channel: ReleaseChannel; alternative: ReleaseChannel | null; onChoose: (channel: ReleaseChannel) => void }) {
  const { t } = useTranslation();
  const name = t(`landing.office.versions.channel.${channel}`);
  return <div className="ver-card ver-state" role="status">
    <span className="ver-state-icon" aria-hidden><Hourglass /></span>
    <h2>{t("landing.office.versions.states.soonTitle", { channel: name })}</h2>
    <p>{t("landing.office.versions.states.soonBody", { channel: name })}</p>
    {alternative && <Button type="button" variant="outline" size="lg" onClick={() => onChoose(alternative)}>{t("landing.office.versions.states.soonAction", { channel: t(`landing.office.versions.channel.${alternative}`) })}</Button>}
  </div>;
}

/** The manifest lists no channel at all. */
export function NothingPublished() {
  const { t } = useTranslation();
  return <div className="ver-card ver-state" role="status">
    <span className="ver-state-icon" aria-hidden><Info /></span>
    <h2>{t("landing.office.versions.states.emptyTitle")}</h2>
    <p>{t("landing.office.versions.states.emptyBody")}</p>
    <Link className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>
  </div>;
}

/** The manifest could not be read: one quiet note; the installer links below it are today's. */
export function ManifestError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return <div className="ver-quiet is-block" role="alert">
    <CircleAlert aria-hidden />
    <div><p>{t("landing.office.versions.states.error")}</p><p className="ver-muted">{t("landing.office.versions.states.errorFallback")}</p></div>
    <Button type="button" variant="outline" size="lg" onClick={onRetry}><RotateCcw aria-hidden />{t("landing.office.retry")}</Button>
  </div>;
}

/** Non-modal: it never takes focus and never moves the page; "Tải lại" swaps the content in place. */
export function UpdateNotice({ found, onApply, onDismiss }: { found: NewVersion; onApply: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  return <div className="ver-notice" role="status">
    <span className="ver-notice-dot" aria-hidden />
    <p>{t("landing.office.versions.update.notice", { version: found.version, channel: t(`landing.office.versions.channel.${found.channel}`) })}</p>
    <Button type="button" variant="brand" size="lg" onClick={onApply}>{t("landing.office.versions.update.action")}</Button>
    <Button type="button" variant="ghost" size="icon-lg" aria-label={t("landing.office.versions.update.dismiss")} onClick={onDismiss}><X aria-hidden /></Button>
  </div>;
}
