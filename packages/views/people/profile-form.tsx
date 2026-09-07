"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import { useDepartments, useUpdateProfile } from "@uniwork/core/people";
import type { Person, ProfileInput } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Field,
  FieldDescription,
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

/**
 * The profile editor. A person owns what they say about themselves; the
 * company owns department, manager, employee code and start date. The
 * company-owned inputs are disabled with the rule's own message as the reason,
 * so the form never offers a control the server would refuse.
 */
export function ProfileForm({
  orgSlug,
  person,
  onDone,
}: {
  orgSlug: string;
  person: Person;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { canEditEmployment } = usePeoplePermissions(orgSlug);
  const { data: departments } = useDepartments(orgSlug);
  const update = useUpdateProfile(orgSlug);
  const [form, setForm] = useState<ProfileInput>({
    title: person.title,
    department_id: person.department?.id ?? "",
    employee_code: person.employee_code ?? "",
    phone: person.phone ?? "",
    phone_visible: person.phone_visible,
    location: person.location ?? "",
    bio: person.bio ?? "",
    joined_on: person.joined_on ?? "",
  });
  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (update.isPending) return;
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
          onDone();
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const employmentHint = canEditEmployment.allowed ? undefined : canEditEmployment.message;

  return (
    <form onSubmit={submit}>
      <FieldGroup>
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
          <FieldLabel htmlFor="profile-department">{t("people.department")}</FieldLabel>
          <DepartmentPicker
            id="profile-department"
            departments={departments ?? []}
            value={form.department_id ?? ""}
            onValueChange={(v) => set("department_id", v)}
            disabled={update.isPending || !canEditEmployment.allowed}
          />
          {employmentHint ? <FieldDescription>{employmentHint}</FieldDescription> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-employee-code">{t("people.field_employee_code")}</FieldLabel>
          <Input
            id="profile-employee-code"
            value={form.employee_code ?? ""}
            onChange={(e) => set("employee_code", e.target.value)}
            disabled={update.isPending || !canEditEmployment.allowed}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-joined-on">{t("people.field_joined_on")}</FieldLabel>
          <DateField
            id="profile-joined-on"
            value={form.joined_on ?? ""}
            onChange={(next) => set("joined_on", next ?? "")}
            disabled={update.isPending || !canEditEmployment.allowed}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="profile-phone">{t("people.field_phone")}</FieldLabel>
          <Input
            id="profile-phone"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            disabled={update.isPending}
          />
          <FieldDescription>{t("people.field_phone_hint")}</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="profile-phone-visible">{t("people.field_phone_visible")}</FieldLabel>
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
          <FieldLabel htmlFor="profile-bio">{t("people.field_bio")}</FieldLabel>
          <Textarea
            id="profile-bio"
            rows={4}
            maxLength={500}
            value={form.bio ?? ""}
            onChange={(e) => set("bio", e.target.value)}
            disabled={update.isPending}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone} disabled={update.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
