"use client";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { MarketingShell } from "../marketing-shell";
import { AppBar } from "../apps/app-bar";
import { AppDownload } from "../apps/app-download";
import { useVisitorDevice } from "../apps/visitor-device";
import { AptInstall } from "./apt-install-placeholder";
import { History } from "./history";
import { LatestCard } from "./latest-card";
import { defaultChannel, latestRelease, RELEASE_CHANNELS, type ReleaseChannel, type ReleasesManifest } from "./manifest";
import { SelfUpdate } from "./self-update";
import { ComingSoon, ManifestError, NothingPublished, UpdateNotice, VersionsSkeleton } from "./states";
import { useChannelParam, useReleases } from "./use-releases";
import "../apps/apps.css";
import "../marketing-chapters.css";
import "../office.css";
import "./versions.css";

const PAGES = [
  { href: paths.apps.office(), labelKey: "landing.office.tabs.overview", current: false },
  { href: paths.apps.officeVersions(), labelKey: "landing.office.tabs.versions", current: true },
] as const;

function ChannelPanel({ manifest, channel, onChoose }: { manifest: ReleasesManifest; channel: ReleaseChannel; onChoose: (channel: ReleaseChannel) => void }) {
  const device = useVisitorDevice();
  const entry = manifest.channels[channel];
  const latest = entry ? latestRelease(entry) : undefined;
  if (!entry || !latest) return <ComingSoon channel={channel} alternative={defaultChannel(manifest)} onChoose={onChoose} />;
  const older = entry.releases.filter((release) => release !== latest);
  return <>
    <LatestCard release={latest} channel={channel} own={device.desktop} />
    <div className="ver-aside">
      <AptInstall suite={entry.apt_suite} />
      <SelfUpdate />
    </div>
    <History releases={older} own={device.desktop} />
  </>;
}

/**
 * UniOffice's second page (UNI-2098): every released version per channel, the
 * apt repository and how the app updates itself. Server-rendered shell; the
 * manifest is read in the browser. Step 1 is fixture-backed (see fixtures.ts).
 */
export function OfficeVersionsPage() {
  const { t } = useTranslation();
  const releases = useReleases();
  const [param, choose] = useChannelParam();
  const { status, manifest } = releases;
  const fallbackChannel = defaultChannel(manifest ?? { schema: 1, generated_at: "", base_url: "", channels: {} }) ?? "stable";
  const active = param ?? fallbackChannel;
  return <MarketingShell className="office-site apps-site versions-site" closingTitle="landing.office.closing" closingAction={{ href: paths.apps.office(), labelKey: "landing.office.hero.explore", icon: "arrow" }}>
    <AppBar app="office" sections={[]} pages={PAGES} cta={{ href: "#versions-latest", label: t("landing.office.versions.cta"), short: t("landing.apps.bar.short") }} />
    <div className="chapter-world office-world">
      <section className="ver-hero chapter-width" aria-labelledby="ver-title">
        <h1 id="ver-title">{t("landing.office.versions.title")}</h1>
        <p className="office-sub">{t("landing.office.versions.sub")}</p>
      </section>
      <div className="ver-main chapter-width">
        {status === "loading" && <VersionsSkeleton />}
        {status === "empty" && <>
          <NothingPublished />
          <AptInstall suite={active} />
        </>}
        {status === "error" && <>
          <ManifestError onRetry={releases.retry} />
          <section className="ver-fallback" aria-label={t("landing.office.versions.states.fallbackTitle")}>
            <h2>{t("landing.office.versions.states.fallbackTitle")}</h2>
            <AppDownload app="office" copy="landing.office" />
          </section>
          <AptInstall suite={active} />
        </>}
        {status === "ready" && manifest && <Tabs value={active} onValueChange={(value) => choose(value as ReleaseChannel)} className="ver-tabs">
          <TabsList aria-label={t("landing.office.versions.channelsLabel")} className="office-tab-list ver-channels">
            {RELEASE_CHANNELS.map((channel) => {
              const entry = manifest.channels[channel];
              return <TabsTrigger key={channel} value={channel} className="office-tab ver-channel">
                <span>{t(`landing.office.versions.channel.${channel}`)}</span>
                <small>{entry ? entry.latest : t("landing.office.versions.soon")}</small>
              </TabsTrigger>;
            })}
          </TabsList>
          <p className="ver-channel-hint">{t(`landing.office.versions.channelHint.${active}`)}</p>
          {RELEASE_CHANNELS.map((channel) => <TabsContent key={channel} value={channel} className="ver-panel">
            {channel === active && <ChannelPanel manifest={manifest} channel={channel} onChoose={choose} />}
          </TabsContent>)}
        </Tabs>}
      </div>
    </div>
    {releases.pending && <UpdateNotice found={releases.pending} onApply={releases.apply} onDismiss={releases.dismiss} />}
  </MarketingShell>;
}
