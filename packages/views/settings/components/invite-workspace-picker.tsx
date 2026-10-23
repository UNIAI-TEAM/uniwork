"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOrgWorkspaces } from "@uniwork/core/organizations";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@uniwork/ui/components/ui/field";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { SettingsLoadError } from "./settings-layout";

/**
 * The workspaces an organization invitation grants (UNI-1582). Joining the
 * organization opens none of them by itself, so the admin picks the ones the
 * invitee joins as a member on accept; none is a valid choice, and the hint
 * says what it means. Every workspace of the organization is listed - only
 * an owner or admin sees this form, and they may open them all.
 */
export function InviteWorkspacePicker({
  id,
  orgId,
  value,
  onChange,
  disabled,
}: {
  id: string;
  orgId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { data: workspaces, isPending, isError, refetch } = useOrgWorkspaces(orgId);
  const toggle = (wsId: string, on: boolean) =>
    onChange(on ? [...value.filter((v) => v !== wsId), wsId] : value.filter((v) => v !== wsId));

  let body: ReactNode;
  if (isPending) {
    body = (
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  } else if (isError) {
    body = <SettingsLoadError onRetry={() => void refetch()}>{t("org.invitations.workspaces_load_error")}</SettingsLoadError>;
  } else if (!workspaces?.length) {
    body = <p className="text-body text-muted-foreground">{t("org.invitations.workspaces_none")}</p>;
  } else {
    body = (
      // A long list scrolls inside its own frame so the send button stays in reach.
      <div className="flex max-h-56 flex-col overflow-y-auto">
        {workspaces.map((w) => {
          const box = `${id}-${w.id}`;
          return (
            <Field key={w.id} orientation="horizontal" className="min-h-9 pointer-coarse:min-h-11">
              <Checkbox
                id={box}
                checked={value.includes(w.id)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(w.id, checked === true)}
              />
              <FieldLabel htmlFor={box} className="min-h-9 min-w-0 items-center text-body font-normal [overflow-wrap:anywhere] pointer-coarse:min-h-11">
                {w.name}
              </FieldLabel>
            </Field>
          );
        })}
      </div>
    );
  }

  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="mb-0">
        {t("org.invitations.workspaces_label")}
      </FieldLegend>
      <FieldDescription>{t("org.invitations.workspaces_hint")}</FieldDescription>
      {body}
    </FieldSet>
  );
}
