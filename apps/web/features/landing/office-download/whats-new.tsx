"use client";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { Release } from "./manifest";
import { ReleaseNotes } from "./notes";

/** Notes longer than this many lines start folded, with a "show more" to open them. */
const FOLD_LINES = 7;

export function useReleaseDate(): (iso: string) => string {
  const { i18n } = useTranslation();
  return (iso) => new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** The latest version's notes: short, and folded when long. */
export function WhatsNew({ release }: { release: Release }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const notes = release.notes_markdown;
  const long = (notes?.split("\n").filter((line) => line.trim() !== "").length ?? 0) > FOLD_LINES;
  const title = t("landing.office.download.notes.title", { version: release.version });
  return <section className="office-dl-whatsnew" aria-label={title}>
    <h3>{title}</h3>
    {notes
      ? <>
        <div id={bodyId} className="office-dl-notes-body" data-folded={(long && !open) || undefined}><ReleaseNotes markdown={notes} /></div>
        {long && <Button type="button" variant="ghost" size="sm" className="office-dl-more" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>{t(open ? "landing.office.download.notes.less" : "landing.office.download.notes.more")}</Button>}
      </>
      : <p className="office-dl-muted">{t("landing.office.download.notes.empty")}</p>}
  </section>;
}
