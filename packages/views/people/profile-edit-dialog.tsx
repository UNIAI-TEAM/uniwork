"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, useUpdateProfile } from "@uniwork/core/people";
import type { Person, ProfileInput } from "@uniwork/core/types/people";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
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
import { toastApiError } from "../toast-api-error";
import { DepartmentPicker } from "./department-picker";

/** The server rejects a longer bio (`maxBioLength` in server/internal/service). */
const MAX_BIO = 500;

function initialForm(person: Person): ProfileInput {
  return {
    title: person.title,
    department_id: person.department?.id ?? "",
    employee_code: person.employee_code ?? "",
    phone: person.phone ?? "",
    phone_visible: person.phone_visible,
    location: person.location ?? "",
    bio: person.bio ?? "",
    joined_on: person.joined_on ?? "",
  };
}

/** A titled run of fields, matching the section heading of the meeting editor. */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {hint ? <p className="mt-1 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      <FieldGroup>{children}</FieldGroup>
    </div>
  );
}

/**
 * The profile editor, in the dialog every other detail screen edits through
 * (`MeetingEditDialog` is the sibling). Editing overlays the profile rather
 * than replacing it, so the facts being edited stay on screen behind it.
 *
 * A person owns what they say about themselves; the company owns department,
 * manager, employee code and start date. That boundary is the section split,
 * so a locked control is explained once by its section instead of field by
 * field.
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
  const { t } = useTranslation();
  const { canEditEmployment } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);
  const update = useUpdateProfile(orgSlug);
  const initial = useMemo(() => initialForm(person), [person]);
  const [form, setForm] = useState<ProfileInput>(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A rejection the server ties to one field, shown on that field. Cleared as
  // soon as the field changes, so a stale message never outlives its cause.
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

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
    if (!next && dirty && !update.isPending) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    // The company-owned fields are only sent when this caller may set them;
    // sending them otherwise would turn a disabled input into a 403.
    const input: ProfileInput = canEditEmployment.allowed
      ? form
      : {
          title: form.title,
          phone: form.phone,
          phone_visible: form.phone_visible,
          location: form.location,
          bio: form.bio,
        };
    update.mutate(
      { userId: person.user_id, input },
      {
        onSuccess: () => {
          toast.success(t("people.profile_saved"));
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
  const employmentDisabled = update.isPending || locked;

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-h-[min(90dvh,44rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("people.edit_profile")}</DialogTitle>
          <DialogDescription>{t("people.edit_profile_description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <FormSection title={t("people.group_personal")} hint={t("people.group_personal_hint")}>
            <Field>
              <FieldLabel htmlFor="profile-title">{t("people.field_title")}</FieldLabel>
              <Input
                id="profile-title"
                value={form.title ?? ""}
                onChange={(e) => set("title", e.target.value)}
                disabled={update.isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-phone">{t("people.field_phone")}</FieldLabel>
              <Input
                id="profile-phone"
                type="tel"
                inputMode="tel"
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                disabled={update.isPending}
              />
              <FieldDescription>{t("people.field_phone_hint")}</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="profile-phone-visible">
                {t("people.field_phone_visible")}
              </FieldLabel>
              <Switch
                id="profile-phone-visible"
                checked={form.phone_visible ?? false}
                onCheckedChange={(checked) => set("phone_visible", checked)}
                disabled={update.isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-location">{t("people.field_location")}</FieldLabel>
              <Input
                id="profile-location"
                value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
                disabled={update.isPending}
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
                  blocked Save say what happened instead. */}
              <Textarea
                id="profile-bio"
                rows={4}
                aria-invalid={bioTooLong || undefined}
                aria-describedby={bioTooLong ? "profile-bio-error" : undefined}
                value={form.bio ?? ""}
                onChange={(e) => set("bio", e.target.value)}
                disabled={update.isPending}
              />
              {bioTooLong ? (
                <FieldError id="profile-bio-error">
                  {t("people.bio_too_long", { max: MAX_BIO })}
                </FieldError>
              ) : null}
            </Field>
          </FormSection>

          <FormSection
            title={t("people.group_company")}
            hint={locked ? t("people.group_company_locked") : undefined}
          >
            <Field>
              <FieldLabel htmlFor="profile-department">{t("people.department")}</FieldLabel>
              <DepartmentPicker
                id="profile-department"
                departments={departments ?? []}
                value={form.department_id ?? ""}
                onValueChange={(v) => set("department_id", v)}
                disabled={employmentDisabled}
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
                disabled={employmentDisabled}
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
                disabled={employmentDisabled}
              />
            </Field>
          </FormSection>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => requestOpenChange(false)}
              disabled={update.isPending}
            >
              {t("common.cancel")}
            </Button>
            {/* `aria-disabled` rather than `disabled`: a Save that cannot run yet
                still has to be reachable, so a keyboard user can find it and read
                why the bio error above it is holding the form. */}
            <Button type="submit" aria-disabled={blocked || undefined}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("people.discard_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("people.discard_description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("people.discard_keep")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              {t("people.discard_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
