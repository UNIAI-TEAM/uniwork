"use client";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { FileChips } from "./download-card";
import { releaseFiles, type Release } from "./manifest";
import { ReleaseNotes } from "./notes";
import { useReleaseDate } from "./whats-new";

function HistoryRow({ release }: { release: Release }) {
  const { t } = useTranslation();
  const date = useReleaseDate();
  const id = useId();
  return <li className="office-dl-history-item">
    <Collapsible>
      <CollapsibleTrigger className="office-dl-history-trigger" aria-label={t("landing.office.download.history.open", { version: release.version })}>
        <strong>{release.version}</strong>
        <time dateTime={release.published_at}>{date(release.published_at)}</time>
        <ChevronDown aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="office-dl-history-panel">
        <div className="office-dl-history-notes">
          {release.notes_markdown ? <ReleaseNotes markdown={release.notes_markdown} /> : <p className="office-dl-muted">{t("landing.office.download.notes.empty")}</p>}
        </div>
        <div className="office-dl-history-files"><h4 id={`${id}-files`}>{t("landing.office.download.history.files")}</h4><FileChips files={releaseFiles(release)} labelledBy={`${id}-files`} /></div>
      </CollapsibleContent>
    </Collapsible>
  </li>;
}

/** Older versions of the channel, each collapsed to one line until opened. */
export function History({ releases }: { releases: readonly Release[] }) {
  const { t } = useTranslation();
  return <section className="office-dl-history" aria-labelledby="office-dl-history-title">
    <h3 id="office-dl-history-title">{t("landing.office.download.history.title")}</h3>
    {releases.length === 0
      ? <p className="office-dl-muted">{t("landing.office.download.history.none")}</p>
      : <ul className="office-dl-history-list">{releases.map((release) => <HistoryRow key={release.version} release={release} />)}</ul>}
  </section>;
}
