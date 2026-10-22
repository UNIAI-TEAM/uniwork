"use client";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { FileList } from "./file-list";
import { NotesPanel, useReleaseDate } from "./latest-card";
import type { Release } from "./manifest";

function HistoryRow({ release, own, defaultOpen }: { release: Release; own: DesktopOS | null; defaultOpen: boolean }) {
  const { t } = useTranslation();
  const date = useReleaseDate();
  const id = useId();
  return <li className="ver-history-item">
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="ver-history-trigger" aria-label={t("landing.office.versions.openVersion", { version: release.version })}>
        <strong>{release.version}</strong>
        <time dateTime={release.published_at}>{date(release.published_at)}</time>
        <span className="ver-history-sha">{t("landing.office.versions.build", { sha: release.git_sha.slice(0, 7) })}</span>
        <ChevronDown aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="ver-history-panel">
        <NotesPanel release={release} headingId={`${id}-notes`} />
        <div><h3>{t("landing.office.versions.downloads")}</h3><FileList release={release} own={own} lead={false} /></div>
      </CollapsibleContent>
    </Collapsible>
  </li>;
}

/** Older versions of the channel, each collapsed to one line until opened. */
export function History({ releases, own, expanded = 0 }: { releases: readonly Release[]; own: DesktopOS | null; expanded?: number }) {
  const { t } = useTranslation();
  return <section className="ver-history" aria-labelledby="ver-history-title">
    <div className="ver-section-head">
      <h2 id="ver-history-title">{t("landing.office.versions.history.title")}</h2>
      <p>{t("landing.office.versions.history.hint")}</p>
    </div>
    {releases.length === 0
      ? <p className="ver-quiet-line">{t("landing.office.versions.history.none")}</p>
      : <ul className="ver-history-list">{releases.map((release, index) => <HistoryRow key={release.version} release={release} own={own} defaultOpen={index < expanded} />)}</ul>}
  </section>;
}
