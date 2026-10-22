"use client";
import { useTranslation } from "react-i18next";
import type { DesktopOS } from "@uniwork/core/office";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { FileList } from "./file-list";
import type { ReleaseChannel, Release } from "./manifest";
import { ReleaseNotes } from "./notes";

export function useReleaseDate(): (iso: string) => string {
  const { i18n } = useTranslation();
  return (iso) => new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function NotesPanel({ release, headingId }: { release: Release; headingId: string }) {
  const { t } = useTranslation();
  return <section className="ver-notes-panel" aria-labelledby={headingId}>
    <h3 id={headingId}>{t("landing.office.versions.notes")}</h3>
    {release.notes_markdown ? <ReleaseNotes markdown={release.notes_markdown} /> : <p className="ver-muted">{t("landing.office.versions.notesEmpty")}</p>}
  </section>;
}

/** The channel's newest version: what it is, the files for the visitor's system first, and what changed. */
export function LatestCard({ release, channel, own }: { release: Release; channel: ReleaseChannel; own: DesktopOS | null }) {
  const { t } = useTranslation();
  const date = useReleaseDate();
  return <article id="versions-latest" className="ver-card ver-latest" aria-labelledby="ver-latest-title">
    <header className="ver-latest-head">
      <div>
        <p className="ver-eyebrow"><Badge className="ver-badge is-channel">{t(`landing.office.versions.channel.${channel}`)}</Badge>{t("landing.office.versions.latest")}</p>
        <h2 id="ver-latest-title">{release.version}</h2>
      </div>
      <p className="ver-meta"><time dateTime={release.published_at}>{t("landing.office.versions.releasedOn", { date: date(release.published_at) })}</time><span>{t("landing.office.versions.build", { sha: release.git_sha.slice(0, 7) })}</span></p>
    </header>
    <div className="ver-latest-body">
      <div className="ver-latest-files">
        <h3>{t("landing.office.versions.downloads")}</h3>
        <FileList release={release} own={own} lead />
      </div>
      <NotesPanel release={release} headingId="ver-latest-notes" />
    </div>
  </article>;
}
