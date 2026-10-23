"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, useUpdateProfile } from "@uniwork/core/people";
import type { Actor, Person, ProfileInput } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogFooter } from "@uniwork/ui/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toast } from "sonner";
import { DateField } from "../common/date-field";
import { ConfirmDialog, FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { DepartmentPicker } from "./department-picker";
import { ManagerPicker } from "./manager-picker";
import { formatJoinedOn } from "./person-facts";

/** The server rejects a longer bio (`maxBioLength` in server/internal/service). */
const MAX_BIO = 500;
const FORM_ID = "profile-edit-form";
/** The fields the company owns; only someone who may set employment sends them. */
const EMPLOYMENT_FIELDS = new Set<keyof ProfileInput>(["department_id", "manager_id", "employee_code", "joined_on"]);

function initialForm(person: Person): ProfileInput {
  return {
    title: person.title,
    department_id: person.department?.id ?? "",
    manager_id: person.manager?.id ?? "",
    employee_code: person.employee_code ?? "",
    phone: person.phone ?? "",
    phone_visible: person.phone_visible,
    location: person.location ?? "",
    bio: person.bio ?? "",
    joined_on: person.joined_on ?? "",
  };
}

/**
 * A titled run of fields. Sentence case — the tracked capitals it used to be
 * in read stiffly with Vietnamese diacritics — one step above the field
 * labels, and a later section ruled off from the one before, so the split
 * between what a person says and what the company records reads while
 * scrolling.
 */
function FormSection({
  title,
  hint,
  divided = false,
  children,
}: {
  title: string;
  hint?: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={divided ? "space-y-3 border-t border-border pt-6" : "space-y-3"}>
      <div>
        <h3 className="text-title-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The profile editor, in the dialog anatomy every form flow shares (header,
 * a body that scrolls on its own, a footer that stays in view). Editing
 * overlays the profile rather than replacing it, so the facts being edited
 * stay on screen behind it.
 *
 * A person owns what they say about themselves; the company owns department,
 * manager, employee code and start date. That boundary is the section split.
 * Someone who may not set the company fields sees them as plain values, not
 * as a column of greyed-out inputs that look broken.
 *
 * The wording follows who is editing: "you" on your own profile, the person's
 * name on someone else's.
 */
export function ProfileEditDialog({
  orgSlug,
  person,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  person: Person;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { canEditEmployment } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);
  const update = useUpdateProfile(orgSlug);
  // Taken once, when the dialog opens. A refetch while it is open (someone
  // else saving this profile) must not mark untouched fields as changed.
  const [initial] = useState(() => initialForm(person));
  const [form, setForm] = useState<ProfileInput>(initial);
  const [manager, setManager] = useState<Actor | null>(person.manager ?? null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A rejection the server ties to one field, shown on that field. Cleared as
  // soon as the field changes, so a stale message never outlives its cause.
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const self = person.is_self;
  const name = person.display_name;

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const bioLength = [...(form.bio ?? "")].length;
  const bioTooLong = bioLength > MAX_BIO;
  // Compared against the values the dialog opened with, so returning a field to
  // what it was leaves the form clean again.
  const dirty = (Object.keys(initial) as Array<keyof ProfileInput>).some(
    (key) => form[key] !== initial[key],
  );
  const blocked = update.isPending || !dirty || bioTooLong;

  /** Every way out of the dialog lands here: Cancel, Escape, the X, the overlay. */
  const requestOpenChange = (next: boolean) => {
    // Closing mid-save would unmount the dialog before the save reports back,
    // so a failure would look like it went through.
    if (!next && update.isPending) return;
    if (!next && dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    // Only the fields this editor changed are sent: sending the rest would
    // write back the values the dialog opened with over anyone else's newer
    // save. The company-owned fields are only sent when this caller may set
    // them; sending them otherwise would turn a read-only value into a 403.
    const input: ProfileInput = {};
    for (const key of Object.keys(initial) as Array<keyof ProfileInput>) {
      if (form[key] === initial[key]) continue;
      if (EMPLOYMENT_FIELDS.has(key) && !canEditEmployment.allowed) continue;
      Object.assign(input, { [key]: form[key] });
    }
    update.mutate(
      { userId: person.user_id, input },
      {
        onSuccess: () => {
          toast.success(self ? t("people.profile_saved") : t("people.profile_saved_other", { name }));
          onOpenChange(false);
        },
        onError: (err) => {
          // A taken employee code is about one field; sending the reader to a
          // toast for it means they have to guess which one.
          if (errorCode(err) === "employee_code_taken") {
            setCodeError(apiErrorMessage(err) ?? t("common.error"));
            codeRef.current?.focus();
            return;
          }
          toastApiError(err, t("common.error"));
        },
      },
    );
  };

  const locked = !canEditEmployment.allowed;
  const pending = update.isPending;
  const departmentName =
    departments?.find((d) => d.id === form.department_id)?.name ?? person.department?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader
          title={self ? t("people.edit_my_profile") : t("people.edit_profile_of", { name })}
          description={self ? t("people.edit_profile_description_self") : t("people.edit_profile_description_other", { name })}
        />
        <FormDialogBody className="space-y-6">
          <form id={FORM_ID} onSubmit={submit} className="space-y-6">
            <FormSection
              title={t("people.group_personal")}
              hint={self ? t("people.group_personal_hint_self") : t("people.group_personal_hint_other", { name })}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-title">{t("people.field_title")}</FieldLabel>
                  <Input
                    id="profile-title"
                    value={form.title ?? ""}
                    onChange={(e) => set("title", e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-phone">{t("people.field_phone")}</FieldLabel>
                  <Input
                    id="profile-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete={self ? "tel" : "off"}
                    value={form.phone ?? ""}
                    onChange={(e) => set("phone", e.target.value)}
                    disabled={pending}
                  />
                  <FieldDescription>
                    {self ? t("people.field_phone_hint_self") : t("people.field_phone_hint_other")}
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="profile-phone-visible">
                    {t("people.field_phone_visible")}
                  </FieldLabel>
                  <Switch
                    id="profile-phone-visible"
                    checked={form.phone_visible ?? false}
                    onCheckedChange={(checked) => set("phone_visible", checked)}
                    disabled={pending}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-location">{t("people.field_location")}</FieldLabel>
                  <Input
                    id="profile-location"
                    value={form.location ?? ""}
                    onChange={(e) => set("location", e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <Field>
                  <div className="flex items-baseline justify-between gap-2">
                    <FieldLabel htmlFor="profile-bio">{t("people.field_bio")}</FieldLabel>
                    <span
                      aria-hidden="true"
                      className={
                        bioTooLong
                          ? "text-caption tabular-nums text-destructive"
                          : "text-caption tabular-nums text-muted-foreground"
                      }
                    >
                      {t("people.bio_counter", { used: bioLength, max: MAX_BIO })}
                    </span>
                  </div>
                  {/* No `maxLength`: a hard stop at 500 leaves someone who pasted a
                      long paragraph with a silently truncated one. The count and the
                      blocked Save say what happened instead. The visible counter
                      would be read out on every keystroke, so the limit is told to
                      a screen reader once, up front. */}
                  <span id="profile-bio-limit" className="sr-only">
                    {t("people.bio_limit", { max: MAX_BIO })}
                  </span>
                  <Textarea
                    id="profile-bio"
                    rows={4}
                    aria-invalid={bioTooLong || undefined}
                    aria-describedby={bioTooLong ? "profile-bio-limit profile-bio-error" : "profile-bio-limit"}
                    value={form.bio ?? ""}
                    onChange={(e) => set("bio", e.target.value)}
                    disabled={pending}
                  />
                  {bioTooLong ? (
                    <FieldError id="profile-bio-error">
                      {t("people.bio_too_long", { max: MAX_BIO })}
                    </FieldError>
                  ) : null}
                </Field>
              </FieldGroup>
            </FormSection>

            <FormSection
              divided
              title={t("people.group_company")}
              hint={locked ? t("people.group_company_locked") : undefined}
            >
              {locked ? (
                <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-muted/50 px-3.5 py-3 sm:grid-cols-2">
                  <ReadOnlyFact label={t("people.department")} value={departmentName} />
                  <ReadOnlyFact label={t("people.manager")} value={person.manager?.display_name ?? ""} />
                  <ReadOnlyFact label={t("people.field_employee_code")} value={form.employee_code ?? ""} />
                  <ReadOnlyFact
                    label={t("people.field_joined_on")}
                    value={formatJoinedOn(form.joined_on ?? "", i18n.language)}
                  />
                </dl>
              ) : (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="profile-department">{t("people.department")}</FieldLabel>
                    <DepartmentPicker
                      id="profile-department"
                      departments={departments ?? []}
                      value={form.department_id ?? ""}
                      onValueChange={(v) => set("department_id", v)}
                      disabled={pending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-manager">{t("people.manager")}</FieldLabel>
                    <ManagerPicker
                      id="profile-manager"
                      orgSlug={orgSlug}
                      personId={person.user_id}
                      value={manager}
                      onChange={(next) => {
                        setManager(next);
                        set("manager_id", next?.id ?? "");
                      }}
                      disabled={pending}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-employee-code">
                      {t("people.field_employee_code")}
                    </FieldLabel>
                    <Input
                      id="profile-employee-code"
                      ref={codeRef}
                      value={form.employee_code ?? ""}
                      aria-invalid={codeError ? true : undefined}
                      aria-describedby={codeError ? "profile-employee-code-error" : undefined}
                      onChange={(e) => {
                        setCodeError(null);
                        set("employee_code", e.target.value);
                      }}
                      disabled={pending}
                    />
                    {codeError ? (
                      <FieldError id="profile-employee-code-error">{codeError}</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="profile-joined-on">{t("people.field_joined_on")}</FieldLabel>
                    <DateField
                      id="profile-joined-on"
                      value={form.joined_on ?? ""}
                      onChange={(next) => set("joined_on", next ?? "")}
                      disabled={pending}
                    />
                  </Field>
                </FieldGroup>
              )}
            </FormSection>
          </form>
        </FormDialogBody>
        <DialogFooter className="items-center px-5 py-3">
          {!dirty && !pending ? (
            <p className="mr-auto min-w-0 text-caption text-muted-foreground">{t("people.no_changes")}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => requestOpenChange(false)}
            disabled={pending}
          >
            {t("common.cancel")}
          </Button>
          {/* `aria-disabled` rather than `disabled`: a Save that cannot run yet
              still has to be reachable, so a keyboard user can find it and read
              why the bio error above it is holding the form. */}
          <Button type="submit" form={FORM_ID} aria-disabled={blocked || undefined} aria-busy={pending || undefined}>
            {pending ? t("people.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </FormDialogContent>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("people.discard_title")}
        description={t("people.discard_description")}
        confirmLabel={t("people.discard_confirm")}
        cancelLabel={t("people.discard_keep")}
        nested
        onConfirm={() => {
          setConfirmDiscard(false);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

function ReadOnlyFact({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={value ? "text-body text-foreground" : "text-body text-muted-foreground italic"}>
        {value || t("people.value_missing")}
      </dd>
    </div>
  );
}
