"use client";

import { Ban, ChevronRight, Copy, IdCard, Mail, Pencil, Phone, RotateCw, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useReactivateOrgMember } from "@uniwork/core/organizations";
import { paths } from "@uniwork/core/paths";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { usePerson } from "@uniwork/core/people";
import type { Actor, Person } from "@uniwork/core/types/people";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "../common/form-dialog";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { useNow } from "../meetings/use-now";
import { AppLink } from "../navigation";
import { toastApiError } from "../toast-api-error";
import { ActorChip } from "./actor-chip";
import { PersonDetailHero } from "./person-detail-hero";
import { PersonDetailSkeleton } from "./person-detail-skeleton";
import { formatInstantDate, formatJoinedOn, formatTimezone, localTimeIn } from "./person-facts";
import { useStartChat } from "./use-start-chat";

/**
 * Nobody sees the edit dialog until they ask for it, and it drags a date
 * picker, a department tree and a toast channel in with it. Split out, and
 * mounted only once asked for, so the first load of a profile does not carry
 * the cost of editing one.
 */
const ProfileEditDialog = lazy(() =>
  import("./profile-edit-dialog").then((m) => ({ default: m.ProfileEditDialog })),
);

/**
 * One fact, its label above its value. Side by side across a wide panel the
 * eye had to cross most of the page to pair them.
 */
function Fact({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-body font-medium break-words text-foreground">
        {children}
        {hint ? <span className="mt-0.5 block text-caption font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
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
        className="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
      />
    </AppLink>
  );
}

/**
 * One way to reach this person, as a row that is entirely the action, with a
 * copy button beside it for the times the address is wanted elsewhere. Its
 * name is its label and value ("Email an@…"), distinct from the hero's
 * "Gửi email cho …" beside the same target. The value sits under its label: an address is long, and squeezing it into the
 * right half of a narrow card broke it mid-word.
 */
function ContactRow({
  icon: Icon,
  label,
  value,
  href,
  copyLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href: string;
  copyLabel: string;
}) {
  const { t } = useTranslation();
  const copy = () => {
    // No clipboard outside a secure context: say so rather than do nothing.
    if (!navigator.clipboard) {
      toast.error(t("people.copy_failed"));
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("common.copied")))
      .catch(() => toast.error(t("people.copy_failed")));
  };
  return (
    <div className="group flex items-stretch transition-colors hover:bg-surface-hover">
      <a href={href} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 py-2.5 pl-4">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-label text-muted-foreground">{label}</span>
          <span className="block text-body break-all text-foreground">{value}</span>
        </span>
      </a>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copyLabel}
        className="my-auto mr-2 text-muted-foreground"
        onClick={copy}
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  );
}

/** One person's profile, with how to reach them and who they work with. */
export function PersonDetailView({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const wsPaths = paths.workspace(orgSlug, workspace.slug);
  const { data, isLoading, isError, error, refetch, isRefetching } = usePerson(orgSlug, userId);
  const { decideEditProfile, decideDeactivate, canEditEmployment } = usePeoplePermissions(orgSlug);
  const reactivate = useReactivateOrgMember(orgSlug);
  const startChat = useStartChat();
  const [editing, setEditing] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  // Ticks each minute, so "it is 14:05 there" stays true on a page left open.
  const now = useNow();
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
        {header(
          <>
            <Skeleton aria-hidden="true" className="inline-block h-4 w-32 align-middle" />
            <span className="sr-only">{t("common.loading")}</span>
          </>,
        )}
        <PersonDetailSkeleton />
      </div>
    );
  }
  // A failure to load is not an absence: only a 404 says the person is not
  // here. Anything else is offered again, not reported as "left the company".
  const missing = !person && (!isError || (error instanceof ApiError && error.status === 404));
  if (!missing && !person) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header(t("people.load_error_title"))}
        <CollectionPageState
          icon={UserRound}
          tone="destructive"
          role="alert"
          title={t("people.load_error_title")}
          description={t("people.load_error_description")}
          actions={
            <Button variant="outline" onClick={() => void refetch()} aria-busy={isRefetching || undefined}>
              <RotateCw aria-hidden="true" className={isRefetching ? "motion-safe:animate-spin" : undefined} />
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!person) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header(t("people.not_found_title"))}
        <CollectionPageState
          icon={UserRound}
          tone={moduleTone("people")}
          title={t("people.not_found_title")}
          description={t("people.not_found_description")}
          actions={
            <AppLink href={wsPaths.people()} className={cn(buttonVariants({ variant: "outline" }))}>
              {t("people.back_to_directory")}
            </AppLink>
          }
        />
      </div>
    );
  }

  const canEdit = decideEditProfile({ user_id: person.user_id });
  const canReactivate = decideDeactivate({ user_id: person.user_id, role: person.org_role });
  const deactivated = person.status === "deactivated";
  const reports = data?.reports ?? [];
  const facts = employmentFacts(person, t, i18n.language, new Date(now));
  const settingsHref = `${wsPaths.settings()}?tab=profile`;
  const openEdit = canEdit.allowed ? () => setEditing(true) : undefined;

  const runReactivate = () =>
    reactivate.mutate(person.user_id, {
      onSuccess: () => {
        setConfirmReactivate(false);
        toast.success(t("people.reactivated", { name: person.display_name }));
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header(
        person.display_name,
        // The reader's own profile carries its edit button in the hero, beside
        // the photo it goes with; the header only repeats it for someone else.
        canEdit.allowed && !person.is_self ? (
          <CollectionPageHeaderAction icon={Pencil} label={t("people.edit_profile")} onClick={() => setEditing(true)} />
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
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          {deactivated ? (
            <Notice
              tone="muted"
              layout="inline"
              icon={Ban}
              live="off"
              action={
                canReactivate.allowed ? (
                  <Button size="sm" variant="outline" onClick={() => setConfirmReactivate(true)}>
                    {t("people.reactivate")}
                  </Button>
                ) : null
              }
            >
              {formatInstantDate(person.deactivated_at, i18n.language)
                ? t("people.deactivated_since", { date: formatInstantDate(person.deactivated_at, i18n.language) })
                : t("people.deactivated_notice")}
            </Notice>
          ) : null}

          {/* Reactivating gives the account its way back into the
              organization, so it is asked once — not destructive, but not
              something a stray click should do. */}
          <ConfirmDialog
            open={confirmReactivate}
            onOpenChange={setConfirmReactivate}
            title={t("people.reactivate_confirm_title", { name: person.display_name })}
            description={t("people.reactivate_confirm_description")}
            confirmLabel={t("people.reactivate")}
            destructive={false}
            pending={reactivate.isPending}
            onConfirm={runReactivate}
          />

          <PersonDetailHero
            person={person}
            onChat={() => startChat(person.user_id)}
            onEdit={openEdit}
            settingsHref={settingsHref}
          />

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              <PanelCard id="person-details" icon={IdCard} title={t("people.details")}>
                {facts.length === 0 ? (
                  <p className="text-body text-muted-foreground">{t("people.details_empty")}</p>
                ) : (
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {facts.map((fact) => (
                      <Fact key={fact.label} label={fact.label} hint={fact.hint}>
                        {fact.value}
                      </Fact>
                    ))}
                  </dl>
                )}
              </PanelCard>

              <PanelCard id="person-reporting" icon={Users} title={t("people.reporting")} flush>
                <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-border">
                  <div className="min-w-0 border-b border-border sm:border-b-0">
                    <p className="px-4 pt-3 text-label text-muted-foreground">{t("people.manager")}</p>
                    {person.manager ? (
                      <PersonRow href={wsPaths.person(person.manager.id)} actor={person.manager} />
                    ) : (
                      <EmptyRelation
                        text={t("people.manager_none")}
                        actionLabel={canEditEmployment.allowed && openEdit ? t("people.manager_assign") : undefined}
                        onAction={openEdit}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="px-4 pt-3 text-label text-muted-foreground">
                      {t("people.reports")}
                      {reports.length > 0 ? (
                        <span className="ml-1.5 tabular-nums">{reports.length}</span>
                      ) : null}
                    </p>
                    {reports.length > 0 ? (
                      <ul className="divide-y divide-border">
                        {reports.map((report) => (
                          <li key={report.id}>
                            <PersonRow href={wsPaths.person(report.id)} actor={report} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyRelation text={t("people.reports_none")} />
                    )}
                  </div>
                </div>
              </PanelCard>
            </div>

            <PanelCard id="person-contact" icon={Mail} title={t("people.contact")} flush>
              <div className="divide-y divide-border">
                <ContactRow
                  icon={Mail}
                  label={t("people.column_email")}
                  value={person.email}
                  href={`mailto:${person.email}`}
                  copyLabel={t("people.copy_email")}
                />
                {person.phone ? (
                  <ContactRow
                    icon={Phone}
                    label={t("people.field_phone")}
                    value={person.phone}
                    href={`tel:${person.phone.replace(/\s+/g, "")}`}
                    copyLabel={t("people.copy_phone")}
                  />
                ) : (
                  <p className="px-4 py-3 text-caption text-muted-foreground">
                    {person.is_self ? t("people.phone_hidden_self") : t("people.phone_hidden")}
                  </p>
                )}
              </div>
            </PanelCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyRelation({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 px-4 pt-1 pb-3">
      <span className="text-body text-muted-foreground">{text}</span>
      {actionLabel && onAction ? (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

interface FactRow {
  label: string;
  value: string;
  hint?: string;
}

/**
 * The employment facts, in one fixed order. Empty ones are dropped rather than
 * shown blank, and the order never depends on which survived — a grid that
 * reflows around missing values gives every colleague a different page.
 * Job title and department are not here: the hero already says them.
 */
function employmentFacts(
  person: Person,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string,
  now: Date,
): FactRow[] {
  const localTime = localTimeIn(person.timezone, language, now);
  const rows: FactRow[] = [
    { label: t("people.field_employee_code"), value: person.employee_code ?? "" },
    { label: t("people.field_joined_on"), value: formatJoinedOn(person.joined_on ?? "", language) },
    { label: t("people.field_location"), value: person.location ?? "" },
    {
      label: t("people.field_timezone"),
      value: formatTimezone(person.timezone, language),
      hint: localTime ? t("people.local_time", { time: localTime }) : undefined,
    },
  ];
  return rows.filter((row) => row.value !== "");
}
