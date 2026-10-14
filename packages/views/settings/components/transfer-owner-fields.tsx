"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OrgMember } from "@uniwork/core/types/people";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { SettingsFieldError, SettingsLoadError } from "./settings-layout";

/** A member's display name, or their email when they have none. */
const nameOf = (m: OrgMember) => m.display_name || m.email;

/**
 * How a candidate is named once chosen (the select's value, the wizard's
 * confirmation line): their name, and their email beside it when another
 * candidate carries the same name, so the owner can tell which one they
 * picked.
 */
export function candidateLabel(member: OrgMember, candidates: OrgMember[]): string {
  if (!member.display_name) return member.email;
  const key = member.display_name.normalize("NFC").trim().toLocaleLowerCase();
  const shared = candidates.some(
    (other) =>
      other.user_id !== member.user_id && other.display_name.normalize("NFC").trim().toLocaleLowerCase() === key,
  );
  return shared ? `${member.display_name} (${member.email})` : member.display_name;
}

/**
 * Who receives the organization. Shared by the Settings transfer dialog and
 * the switch-organization wizard on the invitation page, so both offer the
 * same people the same way (`useTransferCandidates` reads them).
 *
 * Each option shows the email under the name, since two members may share a
 * name. Until the first members arrive the select's place is held by a
 * skeleton of its shape; with nobody to offer (none qualify, or the list
 * failed) it is disabled, so it never opens on an empty list, and the line
 * under it says why.
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
  /** Pages of members are still loading into `candidates`. */
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
  const waiting = loading && candidates.length === 0 && !isError;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("org.transfer.new_owner")}</FieldLabel>
      {waiting ? (
        <Skeleton aria-hidden className="h-8 w-full rounded-control pointer-coarse:h-11" />
      ) : (
        <Select
          value={value}
          disabled={candidates.length === 0}
          onValueChange={(v) => onValueChange((v as string) ?? "")}
          items={candidates.map((m) => ({ value: m.user_id, label: candidateLabel(m, candidates) }))}
        >
          <SelectTrigger id={id} aria-label={t("org.transfer.new_owner")} className="w-full">
            <SelectValue placeholder={t("org.transfer.pick_placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {/* Wraps rather than clips: a long name or address stays whole. */}
                <span className="flex min-w-0 flex-col whitespace-normal [overflow-wrap:anywhere]">
                  <span>{nameOf(m)}</span>
                  {m.display_name ? <span className="text-caption text-muted-foreground">{m.email}</span> : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isError ? (
        <SettingsLoadError onRetry={onRetry}>{t("org.transfer.candidates_error")}</SettingsLoadError>
      ) : waiting ? (
        <span role="status" className="sr-only">
          {t("org.transfer.loading_candidates")}
        </span>
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
