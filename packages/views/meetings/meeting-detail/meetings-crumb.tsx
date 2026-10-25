"use client";
import { useTranslation } from "react-i18next";
import { MODULE_ICONS } from "../../layout/module-icons";

/**
 * The list crumb: the module's violet glyph before "Cuộc họp". It stands in
 * for the eyebrow the header no longer draws above the title. Kept apart from
 * the header so the route's loading skeleton can draw it without the header's code.
 */
export function MeetingsCrumb() {
  const { t } = useTranslation();
  const Glyph = MODULE_ICONS.meetings;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Glyph aria-hidden className="size-4 shrink-0 text-tint-violet-foreground" />
      {t("meetings.title")}
    </span>
  );
}
