"use client";
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { OsMark } from "../apps/os-marks";
import type { OfficeRelease } from "@uniwork/core/api/endpoints/office-releases";
import { OS_ORDER, releaseFiles, type DlFile } from "./manifest";
import { ReleaseNotes } from "./notes";
import { useReleaseDate } from "./whats-new";

/** An older version's builds, grouped by system the same way but compact: one row per OS, its builds as short links. */
function PastBuilds({ files, labelledBy }: { files: readonly DlFile[]; labelledBy: string }) {
  const { t } = useTranslation();
  return <dl className="office-dl-past" aria-labelledby={labelledBy}>
    {OS_ORDER.map((os) => {
      const mine = files.filter((file) => file.os === os);
      if (mine.length === 0) return null;
      return <div key={os} className="office-dl-past-row" data-os={os}>
        <dt><OsMark os={os} />{t(`office.desktop.install.os.${os}`)}</dt>
        <dd>{mine.map((file) => <a key={file.id} className="app-dl-chip office-dl-past-link" href={file.url} download data-file={file.id}
          aria-label={t("landing.office.download.cta", { label: t(`landing.office.download.chip.${file.id}`) })}>{t(`landing.office.download.history.build.${file.id}`)}</a>)}</dd>
      </div>;
    })}
  </dl>;
}

function HistoryRow({ release }: { release: OfficeRelease }) {
  const { t } = useTranslation();
  const date = useReleaseDate();
  const id = useId();
  return <li className="office-dl-history-item">
    <Collapsible>
      <CollapsibleTrigger className="office-dl-history-trigger" aria-label={t("landing.office.download.history.open", { version: release.version })}>
        <strong>{release.version}</strong>
        {release.published_at && <time dateTime={release.published_at}>{date(release.published_at)}</time>}
        <ChevronDown aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="office-dl-history-panel">
        <div className="office-dl-history-notes">
          {release.notes_markdown ? <ReleaseNotes markdown={release.notes_markdown} /> : <p className="office-dl-muted">{t("landing.office.download.notes.empty")}</p>}
        </div>
        <div className="office-dl-history-files"><h4 id={`${id}-files`}>{t("landing.office.download.history.files")}</h4><PastBuilds files={releaseFiles(release)} labelledBy={`${id}-files`} /></div>
      </CollapsibleContent>
    </Collapsible>
  </li>;
}

/** Older versions of the channel, each collapsed to one line until opened. */
export function History({ releases }: { releases: readonly OfficeRelease[] }) {
  const { t } = useTranslation();
  return <section className="office-dl-history" aria-labelledby="office-dl-history-title">
    <h3 id="office-dl-history-title">{t("landing.office.download.history.title")}</h3>
    {releases.length === 0
      ? <p className="office-dl-muted">{t("landing.office.download.history.none")}</p>
      : <ul className="office-dl-history-list">{releases.map((release) => <HistoryRow key={release.version} release={release} />)}</ul>}
  </section>;
}
