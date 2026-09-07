"use client";

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { initials } from "./actor-chip";

/**
 * One directory row. Name and title lead, because that is what people scan
 * for; role and status are badges rather than columns so the row still reads
 * on a phone.
 */
export function PersonRow({
  person,
  onOpen,
  className,
  style,
}: {
  person: Person;
  onOpen: (userId: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const deactivated = person.status === "deactivated";
  return (
    <li className={className} style={style}>
      <button
        type="button"
        onClick={() => onOpen(person.user_id)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-hover"
      >
        <Avatar className="size-8 shrink-0">
          {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
          <AvatarFallback>{initials(person.display_name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-foreground">{person.display_name}</span>
            {deactivated ? (
              <Badge variant="secondary" className="shrink-0">
                {t("people.status_deactivated")}
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-caption text-muted-foreground">
            {[person.title, person.department?.name, person.email].filter(Boolean).join(" · ")}
          </span>
        </span>
        {person.org_role !== "member" ? (
          <Badge variant="outline" className="shrink-0">
            {t(`people.role_${person.org_role}`, { defaultValue: person.org_role })}
          </Badge>
        ) : null}
      </button>
    </li>
  );
}
