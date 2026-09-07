"use client";

import { Pencil, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { usePerson } from "@uniwork/core/people";
import { Avatar, AvatarFallback, AvatarImage } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageState } from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { ActorChip, initials } from "./actor-chip";
import { ProfileForm } from "./profile-form";

/** One person's profile, with the people who report to them. */
export function PersonDetailView({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const { push } = useNavigation();
  const { data, isLoading, isError } = usePerson(orgSlug, userId);
  const { decideEditProfile } = usePeoplePermissions(orgSlug);
  const [editing, setEditing] = useState(false);
  const person = data?.person ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (isError || !person) {
    return (
      <CollectionPageState
        icon={UserRound}
        tone="destructive"
        role="alert"
        title={t("people.not_found_title")}
        description={t("people.not_found_description")}
      />
    );
  }

  const canEdit = decideEditProfile({ user_id: person.user_id });
  const facts: Array<[string, string]> = [
    [t("people.field_title"), person.title],
    [t("people.department"), person.department?.name ?? ""],
    [t("people.field_employee_code"), person.employee_code ?? ""],
    [t("people.field_phone"), person.phone ?? ""],
    [t("people.field_location"), person.location ?? ""],
    [t("people.field_joined_on"), person.joined_on ?? ""],
    [t("people.field_timezone"), person.timezone],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BreadcrumbHeader
        segments={[{ label: t("people.title"), href: paths.workspace(orgSlug, workspace.slug).people() }]}
        leaf={person.display_name}
        actions={
          canEdit.allowed && !editing ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" className="size-3.5" />
              {t("people.edit_profile")}
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <Avatar className="size-14 shrink-0">
              {person.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
              <AvatarFallback className="text-title">{initials(person.display_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-title font-semibold text-foreground">{person.display_name}</h2>
                <Badge variant="outline">
                  {t(`people.role_${person.org_role}`, { defaultValue: person.org_role })}
                </Badge>
                {person.status === "deactivated" ? (
                  <Badge variant="secondary">{t("people.status_deactivated")}</Badge>
                ) : null}
              </div>
              <p className="text-body text-muted-foreground">{person.email}</p>
              {person.bio ? <p className="mt-2 text-body text-foreground">{person.bio}</p> : null}
            </div>
          </div>

          {editing ? (
            <div className="mt-6">
              <ProfileForm orgSlug={orgSlug} person={person} onDone={() => setEditing(false)} />
            </div>
          ) : (
            <dl className="mt-6 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts
                .filter(([, value]) => value !== "")
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-caption text-muted-foreground">{label}</dt>
                    <dd className="text-body text-foreground">{value}</dd>
                  </div>
                ))}
              {person.manager ? (
                <div>
                  <dt className="text-caption text-muted-foreground">{t("people.manager")}</dt>
                  <dd className="text-body text-foreground">
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() =>
                        push(paths.workspace(orgSlug, workspace.slug).person(person.manager!.id))
                      }
                    >
                      <ActorChip actor={person.manager} />
                    </button>
                  </dd>
                </div>
              ) : null}
            </dl>
          )}

          {data && data.reports.length > 0 ? (
            <section className="mt-8">
              <h3 className="mb-2 text-body font-medium text-foreground">{t("people.reports")}</h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {data.reports.map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      className="flex w-full items-center px-4 py-2.5 text-left hover:bg-surface-hover"
                      onClick={() => push(paths.workspace(orgSlug, workspace.slug).person(report.id))}
                    >
                      <ActorChip actor={report} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
