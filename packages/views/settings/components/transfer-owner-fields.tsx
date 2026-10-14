"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OrgMember } from "@uniwork/core/types/people";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { SettingsFieldError, SettingsLoadError } from "./settings-layout";

/**
 * Who receives the organization. Shared by the Settings transfer dialog and
 * the switch-organization wizard on the invitation page, so both offer the
 * same people the same way (`useTransferCandidates` reads them).
 */
export function TransferCandidateField({
  id,
  candidates,
  value,
  onValueChange,
  loading = false,
  isError = false,
  onRetry,
  empty,
}: {
  id: string;
  candidates: OrgMember[];
  value: string;
  onValueChange: (userId: string) => void;
  /** Further pages of members are still loading into `candidates`. */
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /**
   * Shown under the select once the members are read and nobody can receive
   * the organization, so the empty list explains itself where it is.
   */
  empty?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("org.transfer.new_owner")}</FieldLabel>
      <Select
        id={id}
        aria-label={t("org.transfer.new_owner")}
        value={value}
        placeholder={t("org.transfer.pick_placeholder")}
        onValueChange={(v) => onValueChange((v as string) ?? "")}
        items={candidates.map((m) => ({
          value: m.user_id,
          label: m.display_name || m.email,
        }))}
      />
      {isError ? (
        <SettingsLoadError onRetry={onRetry}>{t("org.transfer.candidates_error")}</SettingsLoadError>
      ) : loading ? (
        <FieldDescription role="status" className="flex items-center gap-2">
          <Spinner className="size-3.5 shrink-0" />
          {t("org.transfer.loading_candidates")}
        </FieldDescription>
      ) : empty ? (
        <FieldDescription role="status">{empty}</FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * The owner's current password, re-entered because handing the organization
 * over is the one change they cannot undo alone (OPEN_QUESTIONS P2).
 */
export function TransferPasswordField({
  id,
  value,
  onValueChange,
  error,
}: {
  id: string;
  value: string;
  onValueChange: (password: string) => void;
  /** The server refused the password; shown under the field and announced. */
  error?: string;
}) {
  const { t } = useTranslation();
  const errorId = `${id}-error`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("org.transfer.password_label")}</FieldLabel>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        autoComplete="current-password"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? <SettingsFieldError id={errorId}>{error}</SettingsFieldError> : null}
    </Field>
  );
}
