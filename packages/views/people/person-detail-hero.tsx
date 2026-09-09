"use client";

import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { initials } from "./actor-chip";

/**
 * Who this is, before any of the facts about them: the name as the page's only
 * `h1`, the standing that changes how you read the rest, and the one line most
 * colleagues actually came for — what they do and which team they do it in.
 */
export function PersonDetailHero({ person }: { person: Person }) {
  const { t } = useTranslation();
  const role = t(`people.role_${person.org_role}`, { defaultValue: person.org_role });
  // Job title and department read as one line because neither means much
  // alone: "Trưởng nhóm" of what, "Kỹ thuật" doing what.
  const standing = [person.title, person.department?.name].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
      <Avatar className="size-16 shrink-0 sm:size-20">
        {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
        <AvatarFallback className="text-title">{initials(person.display_name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="min-w-0 text-pretty text-title-lg font-semibold text-foreground">
            {person.display_name}
          </h1>
          <Badge variant="outline">{role}</Badge>
          {person.status === "deactivated" ? (
            <Badge variant="secondary">{t("people.status_deactivated")}</Badge>
          ) : null}
        </div>
        {standing === "" ? null : (
          <p className="text-pretty text-body-lg text-muted-foreground">{standing}</p>
        )}
        {person.bio ? (
          <p className="max-w-prose text-pretty text-body text-foreground">{person.bio}</p>
        ) : null}
      </div>
    </div>
  );
}
