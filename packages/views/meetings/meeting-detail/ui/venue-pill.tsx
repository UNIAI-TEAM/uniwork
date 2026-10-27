"use client";
import { UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * "Trực tiếp" beside the status pill (UNI-2247), in its shape; the caller places it only for an in-person meeting.
 * `gap-1!`: the header's meta line sets `*:gap-1.5` on its children, the board draws the icon 4 from the word.
 */
export function MeetingVenuePill() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-5.5 items-center gap-1! rounded-sm bg-tint-violet px-2 text-caption font-medium whitespace-nowrap text-tint-violet-foreground [&>svg]:size-3 [&>svg]:shrink-0">
      <UsersRound aria-hidden />
      {t("meetings.venue.inPerson")}
    </span>
  );
}
