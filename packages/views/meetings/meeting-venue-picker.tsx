"use client";
import { Check, UsersRound, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MEETING_VENUES, type MeetingVenue } from "@uniwork/core/meetings/venue";
import { cn } from "@uniwork/ui/lib/utils";
import { RadioCardGroup } from "../onboarding/components/option-card";
import { FIELD_LABEL } from "./meeting-sheet/sheet-styles";

const CARD = {
  online: { icon: Video, tint: "bg-tint-blue text-tint-blue-foreground", name: "meetings.venue.online", hint: "meetings.venue.onlineHint" },
  in_person: { icon: UsersRound, tint: "bg-tint-violet text-tint-violet-foreground", name: "meetings.venue.inPerson", hint: "meetings.venue.inPersonHint" },
} as const;

/**
 * Hình thức (UNI-2247 boards 1–2): Online opens a room with a link, Trực tiếp
 * records in the room. Two cards in one radio group; read-only keeps both in
 * view and in the tab order but refuses a change.
 */
export function MeetingVenuePicker({
  value,
  onChange,
  readOnly,
  className,
}: {
  value: MeetingVenue;
  onChange: (v: MeetingVenue) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className}>
      {/* The group carries the same name, so the visible label is not read twice. */}
      <p aria-hidden className={FIELD_LABEL}>
        {t("meetings.venue.label")}
      </p>
      <RadioCardGroup label={t("meetings.venue.label")} className="grid grid-cols-2 gap-2">
        {MEETING_VENUES.map((v) => {
          const card = CARD[v];
          const checked = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={readOnly || undefined}
              onClick={() => !readOnly && !checked && onChange(v)}
              className={cn(
                "relative flex min-w-0 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left not-aria-disabled:hover:bg-surface-hover aria-disabled:cursor-not-allowed",
                checked && "border-primary bg-surface-selected ring-1 ring-primary ring-inset not-aria-disabled:hover:bg-surface-selected",
              )}
            >
              <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-md", card.tint)}>
                <card.icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-medium text-foreground">{t(card.name)}</span>
                <span className="truncate text-caption text-muted-foreground">{t(card.hint)}</span>
              </span>
              {checked ? (
                <span aria-hidden className="absolute top-2 right-2 grid size-4.5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </RadioCardGroup>
    </div>
  );
}
