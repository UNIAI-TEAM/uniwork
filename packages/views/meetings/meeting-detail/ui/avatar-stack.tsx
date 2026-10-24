"use client";
import { useTranslation } from "react-i18next";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";

export type StackPerson = {
  id: string;
  name: string;
  avatarUrl?: unknown;
  tint?: Tint;
  /** The RSVP dot: accepted, declined, or not answered yet. */
  rsvp?: "yes" | "no" | "wait";
};

const RSVP_DOT: Record<NonNullable<StackPerson["rsvp"]>, string> = {
  yes: "bg-success",
  no: "bg-destructive",
  wait: "bg-background inset-ring-[1.5px] inset-ring-input",
};

const LIMIT = 5;

/**
 * Faces in a row (kit `.stack`): 20px discs 2px apart — never overlapped, pale
 * tints would make the initials unreadable — with a page-coloured ring, an
 * RSVP dot on each when given (then 6px apart), and "+n" after five.
 * Decorative: the row it sits in names the people in words.
 */
export function AvatarStack({ people, className }: { people: readonly StackPerson[]; className?: string }) {
  const { t } = useTranslation();
  const shown = people.slice(0, LIMIT);
  const more = people.length - shown.length;
  const dots = shown.some((p) => p.rsvp);
  return (
    <span aria-hidden className={cn("inline-flex align-middle", dots ? "gap-1.5" : "gap-0.5", className)}>
      {shown.map((person) => (
        <span key={person.id} className="relative inline-flex rounded-full">
          <MeetingPersonAvatar
            name={person.name}
            avatarUrl={person.avatarUrl}
            size={20}
            tint={person.tint}
            className="ring-2 ring-background"
          />
          {person.rsvp ? (
            <span
              data-rsvp={person.rsvp}
              className={cn("absolute -right-0.75 -bottom-0.75 size-2 rounded-full ring-2 ring-background", RSVP_DOT[person.rsvp])}
            />
          ) : null}
        </span>
      ))}
      {more > 0 ? (
        <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1 text-micro font-semibold text-muted-foreground ring-2 ring-background">
          {t("meetings.moreParticipantsShort", { count: more })}
        </span>
      ) : null}
    </span>
  );
}
