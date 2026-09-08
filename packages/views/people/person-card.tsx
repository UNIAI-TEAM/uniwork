"use client";

import { Building2, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { AppLink } from "../navigation";
import { initials } from "./actor-chip";

/** Fixed card height in pixels — what lets the card grid be windowed honestly. */
export const PERSON_CARD_HEIGHT = 100;

/**
 * One person, drawn as a card. The head is what people scan for — face, name,
 * job title — and the foot carries the two things they came to look up:
 * department and email. Role and deactivation are badges rather than fields,
 * so the card keeps its height whatever a person's standing is.
 *
 * Only the name is the link; it covers the card through a stretched
 * pseudo-element. That keeps the whole card clickable while the accessible
 * name of the link stays the person's name, instead of the four lines a
 * card-sized anchor would read out.
 */
export function PersonCard({
  person,
  href,
  position,
  total,
}: {
  person: Person;
  href: string;
  /** 1-based place in the directory, for a list the viewport only partly renders. */
  position: number;
  total: number;
}) {
  const { t } = useTranslation();
  const deactivated = person.status === "deactivated";
  return (
    <div
      role="listitem"
      aria-posinset={position}
      aria-setsize={total}
      className="relative flex h-full flex-col overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/50 hover:bg-surface-hover focus-within:border-primary/50"
    >
      <div className="flex items-center gap-3 p-3">
        <Avatar className="size-10 shrink-0">
          {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
          <AvatarFallback>{initials(person.display_name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <AppLink
              href={href}
              className="truncate text-body font-medium text-foreground after:absolute after:inset-0 after:content-['']"
            >
              {person.display_name}
            </AppLink>
            {deactivated ? (
              <Badge variant="secondary" className="shrink-0">
                {t("people.status_deactivated")}
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {person.title || "—"}
          </span>
        </span>
        {person.org_role !== "member" ? (
          <Badge variant="outline" className="shrink-0 self-start">
            {t(`people.role_${person.org_role}`, { defaultValue: person.org_role })}
          </Badge>
        ) : null}
      </div>
      <span className="mt-auto flex items-center gap-1.5 border-t border-border px-3 py-2 text-caption text-muted-foreground">
        <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{person.department?.name ?? "—"}</span>
        <Mail aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{person.email}</span>
      </span>
    </div>
  );
}
