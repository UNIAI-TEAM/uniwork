"use client";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { useAppInstallers } from "../apps/installers";
import { useVisitorDevice } from "../apps/visitor-device";
import { AptInstall } from "./apt-install-placeholder";
import { History } from "./history";
import { defaultChannel, installerFiles, latestRelease, RELEASE_CHANNELS, releaseFiles, type ReleaseChannel, type ReleasesManifest } from "./manifest";
import { OsGroups } from "./os-groups";
import { ComingSoon, DownloadSkeleton, ManifestError, NothingPublished, UpdateNotice } from "./states";
import { useChannelParam, useReleases } from "./use-releases";
import { useReleaseDate, WhatsNew } from "./whats-new";
import "./download.css";

/** The section heading and, once there is a manifest, the channel switch on the same line. */
function Head({ channel, pending = false, children }: { channel: ReleaseChannel | null; pending?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return <div className="office-dl-head">
    <div className="office-heading office-dl-title">
      <h2 id="office-download-title">{t("landing.office.download.title")}</h2>
      {channel && <p>{t(`landing.office.download.channelHint.${channel}`)}</p>}
      {pending && <Skeleton className="office-dl-hint-skeleton" aria-hidden />}
    </div>
    {children}
  </div>;
}

function ChannelPanel({ manifest, channel, onChoose }: { manifest: ReleasesManifest; channel: ReleaseChannel; onChoose: (channel: ReleaseChannel) => void }) {
  const device = useVisitorDevice();
  const date = useReleaseDate();
  const entry = manifest.channels[channel];
  const latest = entry ? latestRelease(entry) : undefined;
  if (!entry || !latest) return <ComingSoon channel={channel} alternative={defaultChannel(manifest)} onChoose={onChoose} />;
  // The layout depends on the visitor's system, so the skeleton stays until the browser has answered: nothing swaps after paint.
  if (!device.settled) return <DownloadSkeleton />;
  return <div className="office-dl-panel">
    <OsGroups files={releaseFiles(latest)} meta={{ version: latest.version, date: date(latest.published_at), channel }} device={device} apt={<AptInstall suite={entry.apt_suite} />} />
    <WhatsNew release={latest} />
    <History releases={entry.releases.filter((release) => release !== latest)} />
  </div>;
}

/** The manifest is unreachable: today's `office_installers` in the same OS groups, apt (inside Linux) for the channel they come from. */
function Fallback({ onRetry }: { onRetry: () => void }) {
  const device = useVisitorDevice();
  const { status, groups, version } = useAppInstallers("office_installers");
  const installers = groups.flatMap((group) => group.installers);
  // The suite follows the channel the fallback installers come from (selectOfficeInstallerChannel), else dev.
  const suite = installers[0]?.channel ?? "dev";
  return <div className="office-dl-panel">
    <ManifestError onRetry={onRetry} />
    {status === "loading" || !device.settled ? <DownloadSkeleton /> : installers.length > 0 && <OsGroups files={installerFiles(installers)} meta={{ version }} device={device} apt={<AptInstall suite={suite} />} />}
  </div>;
}

/**
 * The Download section of /apps/office (UNI-2098 r4): the heading with the
 * release channel switch, the builds grouped by Windows / macOS / Linux (apt
 * inside Linux), what is new and the earlier versions. The manifest is read in the
 * browser after hydration, so the server and the first client render agree on
 * the skeleton. Fixture-backed in Step 1 (see fixtures.ts).
 */
export function OfficeDownload() {
  const { t } = useTranslation();
  const releases = useReleases();
  const [param, choose] = useChannelParam();
  const { status, manifest } = releases;
  const active = param ?? (manifest ? defaultChannel(manifest) : null) ?? "stable";
  return <div className="office-dl" data-state={status}>
    {status === "ready" && manifest
      ? <Tabs value={active} onValueChange={(value) => choose(value as ReleaseChannel)}>
        <Head channel={active}>
          <TabsList aria-label={t("landing.office.download.channelsLabel")} className="office-tab-list office-dl-channels">
            {RELEASE_CHANNELS.map((channel) => <TabsTrigger key={channel} value={channel} className="office-tab office-dl-channel">
              <span>{t(`landing.office.download.channel.${channel}`)}</span>
              {!manifest.channels[channel] && <small>{t("landing.office.download.soon")}</small>}
            </TabsTrigger>)}
          </TabsList>
        </Head>
        {RELEASE_CHANNELS.map((channel) => <TabsContent key={channel} value={channel}>
          {channel === active && <ChannelPanel manifest={manifest} channel={channel} onChoose={choose} />}
        </TabsContent>)}
      </Tabs>
      : <>
        <Head channel={null} pending={status === "loading"}>{status === "loading" && <div className="office-dl-channels-skeleton" aria-hidden>{[0, 1, 2].map((n) => <Skeleton key={n} className="office-dl-channel-skeleton" />)}</div>}</Head>
        {status === "loading" && <DownloadSkeleton />}
        {status === "empty" && <div className="office-dl-panel"><NothingPublished /></div>}
        {status === "error" && <Fallback onRetry={releases.retry} />}
      </>}
    {releases.pending && <UpdateNotice found={releases.pending} onApply={releases.apply} onDismiss={releases.dismiss} />}
  </div>;
}
