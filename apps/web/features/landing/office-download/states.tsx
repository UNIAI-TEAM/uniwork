"use client";
import { CircleAlert, Hourglass, Info, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { MarketingLink as Link } from "../../../platform/marketing-link";
import type { ReleaseChannel } from "./manifest";
import type { NewVersion } from "./use-releases";

/** The shape most visitors get (their system as the spotlight, two other cards), so a desktop visitor sees nothing move. */
export function DownloadSkeleton() {
  const { t } = useTranslation();
  return <div className="office-dl-skeleton" aria-busy="true">
    <p className="office-dl-loading" role="status"><Spinner />{t("landing.office.download.states.loading")}</p>
    <div className="office-dl-spot is-skeleton" aria-hidden>
      <div className="office-dl-spot-copy"><Skeleton className="office-dl-pill-skeleton" /><Skeleton className="office-dl-title-skeleton" /><Skeleton className="office-dl-line-skeleton is-short" /><Skeleton className="office-dl-hero-skeleton" /></div>
      <div className="office-dl-spot-media"><Skeleton className="office-dl-media-skeleton" /></div>
    </div>
    <div className="office-dl-others is-secondary" aria-hidden><div className="office-dl-groups">{[0, 1].map((n) => <div key={n} className="office-dl-group is-skeleton">
      <div className="office-dl-group-head"><Skeleton className="office-dl-tile-skeleton" /><div className="office-dl-group-name"><Skeleton className="office-dl-line-skeleton" /><Skeleton className="office-dl-line-skeleton is-short" /></div></div>
      <div className="office-dl-builds">{[0, 1].map((m) => <Skeleton key={m} className="office-dl-build-skeleton" />)}</div>
    </div>)}</div></div>
  </div>;
}

/** A channel the manifest has never published (stable, today). */
export function ComingSoon({ channel, alternative, onChoose }: { channel: ReleaseChannel; alternative: ReleaseChannel | null; onChoose: (channel: ReleaseChannel) => void }) {
  const { t } = useTranslation();
  const name = t(`landing.office.download.channel.${channel}`);
  return <div className="office-dl-state" role="status">
    <span className="office-dl-state-icon" aria-hidden><Hourglass /></span>
    <h3>{t("landing.office.download.states.soonTitle", { channel: name })}</h3>
    <p>{t("landing.office.download.states.soonBody", { channel: name })}</p>
    {alternative && <Button type="button" variant="outline" size="lg" onClick={() => onChoose(alternative)}>{t("landing.office.download.states.soonAction", { channel: t(`landing.office.download.channel.${alternative}`) })}</Button>}
  </div>;
}

/** The manifest lists no channel at all. */
export function NothingPublished() {
  const { t } = useTranslation();
  return <div className="office-dl-state" role="status">
    <span className="office-dl-state-icon" aria-hidden><Info /></span>
    <h3>{t("landing.office.download.states.emptyTitle")}</h3>
    <p>{t("landing.office.download.states.emptyBody")}</p>
    <Link className={buttonVariants({ variant: "outline", size: "lg" })} href={paths.login()}>{t("landing.apps.download.openWeb")}</Link>
  </div>;
}

/** The manifest could not be read: one quiet note; the installers below it are today's. */
export function ManifestError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return <div className="office-dl-quiet-alert" role="alert">
    <CircleAlert aria-hidden />
    <div><p>{t("landing.office.download.states.error")}</p><p className="office-dl-muted">{t("landing.office.download.states.errorFallback")}</p></div>
    <Button type="button" variant="outline" size="lg" onClick={onRetry}><RotateCcw aria-hidden />{t("landing.office.retry")}</Button>
  </div>;
}

/** Non-modal: it never takes focus and never moves the page; "Tải lại" swaps the content in place. */
export function UpdateNotice({ found, onApply, onDismiss }: { found: NewVersion; onApply: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  return <div className="office-dl-notice" role="status">
    <span className="office-dl-notice-dot" aria-hidden />
    <p>{t("landing.office.download.update.notice", { version: found.version, channel: t(`landing.office.download.channel.${found.channel}`) })}</p>
    <Button type="button" variant="brand" size="lg" onClick={onApply}>{t("landing.office.download.update.action")}</Button>
    <Button type="button" variant="ghost" size="icon-lg" aria-label={t("landing.office.download.update.dismiss")} onClick={onDismiss}><X aria-hidden /></Button>
  </div>;
}
