"use client";

import { Camera, Mail, MessageSquare, Pencil, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Person } from "@uniwork/core/types/people";
import { tintForegroundClass } from "@uniwork/ui/components/common/icon-tile";
import { Button, ButtonLink, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../navigation";
import { PersonAvatar } from "./person-avatar";
import { DeactivatedBadge, RoleBadge, SelfTag } from "./person-badges";
import { useDepartmentTint } from "./use-department-tint";

/**
 * Who this is, before any of the facts about them: the name as the page's only
 * `h1`, the standing that changes how you read the rest, the one line most
 * colleagues came for — what they do and which team they do it in — and,
 * right under it, the ways to reach them. A directory exists to start a
 * conversation, so those are the page's primary actions, not a side panel.
 *
 * On the reader's own profile the actions turn to their own: edit it, change
 * the photo (which lives with the account, in Settings).
 */
export function PersonDetailHero({
  person,
  onChat,
  onEdit,
  settingsHref,
}: {
  person: Person;
  onChat: () => void;
  /** Present when the reader may edit this profile. */
  onEdit?: () => void;
  settingsHref: string;
}) {
  const { t } = useTranslation();
  const deactivated = person.status === "deactivated";
  const department = person.department;
  const tintFor = useDepartmentTint();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <PersonAvatar
        id={person.user_id}
        name={person.display_name}
        avatarUrl={person.avatar_url}
        size="lg"
        deactivated={deactivated}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h1 className="min-w-0 text-pretty text-display-sm font-semibold text-foreground">
            {person.display_name}
          </h1>
          {person.is_self ? <SelfTag className="h-5 px-1.5 text-caption" /> : null}
          <RoleBadge role={person.org_role} />
          {deactivated ? <DeactivatedBadge /> : null}
        </div>
        {person.title || department ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-lg text-muted-foreground">
            {person.title ? <span>{person.title}</span> : null}
            {person.title && department ? <span aria-hidden="true">·</span> : null}
            {department ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full bg-current", tintForegroundClass[tintFor(department.id)])}
                />
                {department.name}
              </span>
            ) : null}
          </p>
        ) : null}
        {person.bio ? (
          <p className="max-w-prose text-pretty text-body text-foreground">{person.bio}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {person.is_self ? (
            <>
              {onEdit ? (
                <Button onClick={onEdit}>
                  <Pencil aria-hidden="true" />
                  {t("people.edit_my_profile")}
                </Button>
              ) : null}
              <AppLink href={settingsHref} className={cn(buttonVariants({ variant: "outline" }))}>
                <Camera aria-hidden="true" />
                {t("people.change_photo")}
              </AppLink>
            </>
          ) : (
            <>
              {deactivated ? null : (
                <Button onClick={onChat}>
                  <MessageSquare aria-hidden="true" />
                  {t("people.chat")}
                </Button>
              )}
              <ButtonLink
                variant={deactivated ? "default" : "outline"}
                href={`mailto:${person.email}`}
                aria-label={t("people.email_person", { name: person.display_name })}
              >
                <Mail aria-hidden="true" />
                {t("people.send_email")}
              </ButtonLink>
              {person.phone ? (
                <ButtonLink
                  variant="outline"
                  href={`tel:${person.phone.replace(/\s+/g, "")}`}
                  aria-label={t("people.call_person", { name: person.display_name })}
                >
                  <Phone aria-hidden="true" />
                  {t("people.call")}
                </ButtonLink>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
