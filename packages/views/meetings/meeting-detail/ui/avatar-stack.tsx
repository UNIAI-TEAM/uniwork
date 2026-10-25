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
};

const LIMIT = 5;

/**
 * Faces in a row (kit `.stack`): 20px discs 2px apart — never overlapped, pale
 * tints would make the initials unreadable — with a page-coloured ring, and
 * "+n" after five. Decorative: the row it sits in names the people in words.
 */
export function AvatarStack({ people, className }: { people: readonly StackPerson[]; className?: string }) {
  const { t } = useTranslation();
  const shown = people.slice(0, LIMIT);
  const more = people.length - shown.length;
  return (
    <span aria-hidden className={cn("inline-flex gap-0.5 align-middle", className)}>
      {shown.map((person) => (
        <MeetingPersonAvatar
          key={person.id}
          name={person.name}
          avatarUrl={person.avatarUrl}
          size={20}
          tint={person.tint}
          className="ring-2 ring-background"
        />
      ))}
      {more > 0 ? (
        <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1 text-micro font-semibold text-muted-foreground ring-2 ring-background">
          {t("meetings.moreParticipantsShort", { count: more })}
        </span>
      ) : null}
    </span>
  );
}
