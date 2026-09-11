"use client";

import { ChevronRight, IdCard, Mail, Pencil, Phone, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { usePerson } from "@uniwork/core/people";
import type { Actor, Person } from "@uniwork/core/types/people";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { PanelCard } from "../common/panel-card";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { ActorChip } from "./actor-chip";
import { PersonDetailHero } from "./person-detail-hero";
import { PersonDetailSkeleton } from "./person-detail-skeleton";
import { formatJoinedOn, formatTimezone } from "./person-facts";

/**
 * Nobody sees the edit dialog until they ask for it, and it drags a date
 * picker, a department tree and a toast channel in with it. Split out, and
 * mounted only once asked for, so the first load of a profile does not carry
 * the cost of editing one.
 */
const ProfileEditDialog = lazy(() =>
  import("./profile-edit-dialog").then((m) => ({ default: m.ProfileEditDialog })),
);

/** One label/value pair of the fact list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body text-foreground">{children}</dd>
    </div>
  );
}

/**
 * One person, reachable in one click. Rows that navigate are anchors, not
 * buttons, so a middle click opens a tab and a screen reader announces a link;
 * `min-h-11` keeps them within reach of a thumb.
 */
function PersonRow({ href, actor }: { href: string; actor: Actor }) {
  return (
    <AppLink
      href={href}
      className="group flex min-h-11 items-center gap-2 px-4 py-2 transition-colors hover:bg-surface-hover"
    >
      <ActorChip actor={actor} className="min-w-0 flex-1" />
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-muted-foreground"
      />
    </AppLink>
  );
}

/**
 * One way to reach this person, as a row that is entirely the action. The
 * value sits under its label rather than beside it: an address is long, and
 * squeezing it into the right half of a narrow card broke it mid-word.
 */
function ContactRow({
  icon: Icon,
  label,
  value,
  href,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href: string;
  ariaLabel: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className="flex min-h-11 items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-faint-foreground" />
      <span className="min-w-0">
        <span className="block text-label text-muted-foreground">{label}</span>
        <span className="block break-words text-body text-foreground">{value}</span>
      </span>
    </a>
  );
}

/** One person's profile, with how to reach them and who they work with. */
export function PersonDetailView({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const wsPaths = paths.workspace(orgSlug, workspace.slug);
  const { data, isLoading, isError } = usePerson(orgSlug, userId);
  const { decideEditProfile } = usePeoplePermissions(orgSlug);
  const [editing, setEditing] = useState(false);
  const person = data?.person ?? null;

  const header = (leaf: React.ReactNode, actions?: React.ReactNode) => (
    <BreadcrumbHeader
      segments={[{ label: t("people.title"), href: wsPaths.people() }]}
      leaf={leaf}
      actions={actions}
    />
  );

  if (isLoading) {
    // Skeletons rather than a spinner, for the same reason the directory uses
    // them: the page lands in its final shape instead of jumping into it.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header(t("common.loading"))}
        <PersonDetailSkeleton />
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
  const reports = data?.reports ?? [];
  const facts = employmentFacts(person, t, i18n.language);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header(
        person.display_name,
        canEdit.allowed ? (
          <CollectionPageHeaderAction
            icon={Pencil}
            label={t("people.edit_profile")}
            onClick={() => setEditing(true)}
          />
        ) : null,
      )}
      {/* Mounted only once asked for, so the lazy chunk above is fetched on the
          first edit rather than on every profile view. */}
      {editing ? (
        <Suspense fallback={null}>
          <ProfileEditDialog orgSlug={orgSlug} person={person} open onOpenChange={setEditing} />
        </Suspense>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <PersonDetailHero person={person} />

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <PanelCard id="person-details" icon={IdCard} title={t("people.details")}>
              {facts.length === 0 ? (
                <p className="text-body text-muted-foreground">{t("people.details_empty")}</p>
              ) : (
                <dl className="-my-2.5 divide-y divide-border">
                  {facts.map(([label, value]) => (
                    <Fact key={label} label={label}>
                      {value}
                    </Fact>
                  ))}
                </dl>
              )}
            </PanelCard>

            <div className="flex min-w-0 flex-col gap-4">
              {/* A directory exists to start a conversation, so the address
                  is the action rather than a string to copy out. */}
              <PanelCard id="person-contact" icon={Mail} title={t("people.contact")} flush>
                <div className="divide-y divide-border">
                  <ContactRow
                    icon={Mail}
                    label={t("people.column_email")}
                    value={person.email}
                    href={`mailto:${person.email}`}
                    ariaLabel={t("people.email_person", { name: person.display_name })}
                  />
                  {person.phone ? (
                    <ContactRow
                      icon={Phone}
                      label={t("people.field_phone")}
                      value={person.phone}
                      href={`tel:${person.phone.replace(/\s+/g, "")}`}
                      ariaLabel={t("people.call_person", { name: person.display_name })}
                    />
                  ) : null}
                </div>
              </PanelCard>

              {person.manager || reports.length > 0 ? (
                <PanelCard id="person-reporting" icon={Users} title={t("people.reporting")} flush>
                  {person.manager ? (
                    <div className={reports.length > 0 ? "border-b border-border" : undefined}>
                      <p className="px-4 pt-3 text-label text-muted-foreground">
                        {t("people.manager")}
                      </p>
                      <PersonRow href={wsPaths.person(person.manager.id)} actor={person.manager} />
                    </div>
                  ) : null}
                  {reports.length > 0 ? (
                    <div>
                      <p className="px-4 pt-3 text-label text-muted-foreground">
                        {t("people.reports")}
                      </p>
                      <ul className="divide-y divide-border">
                        {reports.map((report) => (
                          <li key={report.id}>
                            <PersonRow href={wsPaths.person(report.id)} actor={report} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </PanelCard>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The employment facts, in one fixed order. Empty ones are dropped rather than
 * shown blank, and the order never depends on which survived — a grid that
 * reflows around missing values gives every colleague a different page.
 * Job title and department are not here: the hero already says them.
 */
function employmentFacts(
  person: Person,
  t: (key: string) => string,
  language: string,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    [t("people.field_employee_code"), person.employee_code ?? ""],
    [t("people.field_joined_on"), formatJoinedOn(person.joined_on ?? "", language)],
    [t("people.field_location"), person.location ?? ""],
    [t("people.field_timezone"), formatTimezone(person.timezone, language)],
  ];
  return rows.filter(([, value]) => value !== "");
}
