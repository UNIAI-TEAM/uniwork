"use client";

import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { DeactivatedBadge, RoleBadge, SelfTag } from "./person-badges";
import { PersonAvatar } from "./person-avatar";
import { PersonQuickActions } from "./person-quick-actions";
import { useDepartmentTint } from "./use-department-tint";

/**
 * Fixed card height — what lets the card grid be windowed honestly. In rem, so
 * the card grows with the reader's text size instead of spilling out of it.
 */
export const PERSON_CARD_HEIGHT_REM = 7;
/** Space between cards, across and down; paid as padding so windowing stays exact. */
export const CARD_GAP_REM = 0.75;

/**
 * One person, drawn as a card. The head is what people scan for — face, name,
 * job title — and the foot says which team they sit in and offers the two
 * ways to reach them. The address itself is behind the mail button (its
 * title and label) rather than printed: at card width it was cut to a
 * dozen characters, which said nothing.
 *
 * Only the name is the link; it covers the card through a stretched
 * pseudo-element. That keeps the whole card clickable while the accessible
 * name of the link stays the person's name, instead of the four lines a
 * card-sized anchor would read out. The quick actions sit above it. The
 * link's focus ring is drawn on that pseudo-element, so a keyboard reader
 * sees the whole card selected rather than a box around the name.
 */
export function PersonCard({
  person,
  href,
  position,
  total,
  onChat,
}: {
  person: Person;
  href: string;
  /** 1-based place in the directory, for a list the viewport only partly renders. */
  position: number;
  total: number;
  onChat: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const deactivated = person.status === "deactivated";
  return (
    <div
      role="listitem"
      aria-posinset={position}
      aria-setsize={total}
      className={cn(
        "group/card relative flex h-full flex-col rounded-xl border border-surface-border bg-surface shadow-[var(--surface-shadow)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-brand/40 hover:shadow-[var(--menu-shadow)]",
        deactivated && "bg-muted/40 shadow-none",
      )}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3 px-3.5 pt-3.5">
        <PersonAvatar
          id={person.user_id}
          name={person.display_name}
          avatarUrl={person.avatar_url}
          deactivated={deactivated}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <AppLink
              href={href}
              className={cn(
                "truncate text-body font-semibold text-foreground outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring",
                deactivated && "text-muted-foreground",
              )}
            >
              {person.display_name}
            </AppLink>
            {person.is_self ? <SelfTag /> : null}
          </span>
          <span
            className={cn("mt-0.5 block truncate text-caption text-muted-foreground", !person.title && "italic")}
          >
            {person.title || t("people.title_missing")}
          </span>
        </span>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-3.5">
        <DepartmentLabel person={person} />
        {/* Standing sits in the foot, not beside the name: a role chip and
            the "Bạn" tag next to it cut "Đỗ Thị Hà" down to "Đỗ T…". */}
        {deactivated ? <DeactivatedBadge /> : <RoleBadge role={person.org_role} />}
        <PersonQuickActions person={person} onChat={onChat} />
      </div>
    </div>
  );
}

function DepartmentLabel({ person }: { person: Person }) {
  const { t } = useTranslation();
  const tintFor = useDepartmentTint();
  const department = person.department;
  if (!department) {
    return (
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground italic">
        {t("people.department_missing")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full bg-current", tintForegroundClass[tintFor(department.id)])}
      />
      <span className="truncate">{department.name}</span>
    </span>
  );
}
