"use client";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import { useOrgMembers, useTransferOwnership } from "@uniwork/core/organizations";
import { passwordRefusal } from "@uniwork/core/organizations/errors";
import type { OrgMember } from "@uniwork/core/types/people";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { toast } from "sonner";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError } from "./settings-layout";
import { TransferCandidateField, TransferPasswordField } from "./transfer-owner-fields";

type TransferCandidates = {
  candidates: OrgMember[];
  /** Known to be empty: every page is loaded and nobody qualifies. */
  none: boolean;
  /** More pages are still being read, so the list may be incomplete. */
  loading: boolean;
  isError: boolean;
  retry: () => void;
};

/**
 * Who may receive the organization: active members other than the owner.
 * The member list is cursor-paginated and has no search, so a candidate may
 * sit on a page nobody scrolled to. Pages are read until one candidate turns
 * up (enough to say the action is possible), and all of them once the dialog
 * is open (`fetchAll`), so the picker offers everyone. Each page joins the
 * picker as it lands, so the first members can be chosen while the rest
 * load. "Nobody" is only ever claimed after the last page. With `enabled`
 * false (a plain member's settings) nothing is read at all.
 */
export function useTransferCandidates(orgSlug: string, fetchAll: boolean, enabled = true): TransferCandidates {
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useOrgMembers(
    orgSlug,
    "active",
    enabled,
  );
  const candidates = useMemo(
    () =>
      (data?.pages ?? []).flatMap((p) => p.members).filter((m) => !m.deactivated_at && m.role !== "owner"),
    [data],
  );
  const wantMore = enabled && hasNextPage && !isError && (fetchAll || candidates.length === 0);
  useEffect(() => {
    if (wantMore && !isFetchingNextPage) void fetchNextPage();
  }, [wantMore, isFetchingNextPage, fetchNextPage]);
  return {
    candidates,
    none: enabled && !isLoading && !isError && !hasNextPage && candidates.length === 0,
    loading: enabled && (isLoading || Boolean(wantMore)),
    isError,
    retry: () => void refetch(),
  };
}

const normalize = (text: string) => text.normalize("NFC").trim();

/** What changes for whom, one line each: the owner is giving up control. */
const CONSEQUENCES = [
  "org.transfer.consequences.new_owner",
  "org.transfer.consequences.you_admin",
  "org.transfer.consequences.no_undo",
] as const;

/**
 * Handing the organization to somebody else. Two deliberate frictions, because
 * the outgoing owner cannot undo this alone: they type the organization's name,
 * and they re-enter their password (OPEN_QUESTIONS P2). Nothing typed survives
 * a close, and the dialog cannot be dismissed while the transfer is in flight.
 *
 * A refused password is answered where it was typed, as the invitation
 * switch does: the field is emptied, marked and focused, with the reason
 * under it. An account without a password (Google-only) cannot confirm at
 * all, so the field gives way to a sentence saying so.
 */
export function TransferOwnershipDialog({
  orgSlug,
  organizationName,
  candidates,
  loadingCandidates = false,
  candidatesError = false,
  onRetryCandidates,
  open,
  onOpenChange,
  focusAfterTransfer,
}: {
  orgSlug: string;
  organizationName: string;
  candidates: OrgMember[];
  /** Further pages of members are still loading into `candidates`. */
  loadingCandidates?: boolean;
  candidatesError?: boolean;
  onRetryCandidates?: () => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Where focus goes once the transfer is done. The button that opened the
   * dialog belongs to the owner's rows, which the new role takes away, so
   * returning focus to it would drop it on <body>.
   */
  focusAfterTransfer?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const transfer = useTransferOwnership(orgSlug);
  const ids = useId();
  const targetId = `${ids}-target`;
  const confirmId = `${ids}-confirm`;
  const passwordId = `${ids}-password`;
  const reasonId = `${ids}-reason`;
  const [toUserId, setToUserId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  // The server said this account has no password to confirm with.
  const [refusedPasswordless, setRefusedPasswordless] = useState(false);
  const passwordless = refusedPasswordless || user?.has_password === false;
  const transferred = useRef(false);
  // NFC on both sides: a name typed with a Vietnamese IME can arrive
  // decomposed (NFD) and would never match the stored, composed one.
  const typed = normalize(confirmName);
  const expected = normalize(organizationName);
  const nameMatches = typed === expected;
  // Quiet while the reader is still typing a correct prefix; loud once they
  // leave the field or type something that cannot become the name.
  const showNameError = typed !== "" && !nameMatches && (confirmTouched || !expected.startsWith(typed));
  // What still stands between the owner and the action, first gap first: a
  // sentence beside the held-back button, and its description.
  const missing = passwordless
    ? t("org.transfer.reason_no_password")
    : toUserId === ""
      ? t("org.transfer.reason_pick")
      : !nameMatches
        ? t("org.transfer.reason_name")
        : password === ""
          ? t("org.transfer.reason_password")
          : null;

  // A refused password takes focus back to its field, whose description
  // says why; the effect runs once the emptied, marked field is rendered.
  useEffect(() => {
    if (passwordError) document.getElementById(passwordId)?.focus();
  }, [passwordError, passwordId]);

  // Closing forgets everything, so reopening never finds the password or a
  // half-made choice from last time.
  const close = () => {
    setToUserId("");
    setConfirmName("");
    setConfirmTouched(false);
    setPassword("");
    setPasswordError(undefined);
    setRefusedPasswordless(false);
    onOpenChange(false);
  };

  const changeOpen = (next: boolean) => {
    if (next) {
      transferred.current = false;
      onOpenChange(true);
    } else if (!transfer.isPending) close();
  };

  const changePassword = (next: string) => {
    setPassword(next);
    setPasswordError(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (missing || transfer.isPending) return;
    transfer.mutate(
      { toUserId, password },
      {
        onSuccess: () => {
          transferred.current = true;
          toast.success(t("org.transfer.done"));
          close();
        },
        onError: (err) => {
          const refusal = passwordRefusal(err);
          if (refusal === null) {
            toastApiError(err, t("common.error"));
            return;
          }
          // The password is never kept past a refusal; the owner types it again.
          setPassword("");
          if (refusal === "missing") setRefusedPasswordless(true);
          else setPasswordError(t("org.transfer.wrong_password"));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <FormDialogContent
        destructive
        showCloseButton={!transfer.isPending}
        finalFocus={() => (transferred.current ? (focusAfterTransfer?.current ?? true) : true)}
      >
        <form onSubmit={submit}>
          <FormDialogHeader
            title={t("org.transfer.confirm_title", { name: organizationName })}
            description={t("org.transfer.confirm_lede")}
          />
          <FormDialogBody>
            {/* A warning, not an error: nothing is lost, but it cannot be
                undone alone. `note` keeps it from interrupting on open. The
                bullets are its only markers, as on the close dialog. */}
            <Alert variant="warning" role="note">
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4 text-pretty">
                  {CONSEQUENCES.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
            <TransferCandidateField
              id={targetId}
              candidates={candidates}
              value={toUserId}
              onValueChange={setToUserId}
              loading={loadingCandidates}
              isError={candidatesError}
              onRetry={onRetryCandidates}
            />
            <Field>
              <FieldLabel htmlFor={confirmId}>{t("org.transfer.confirm_label")}</FieldLabel>
              <FieldDescription id={`${confirmId}-hint`}>
                <Trans
                  t={t}
                  i18nKey="org.transfer.confirm_prompt"
                  values={{ name: organizationName }}
                  components={{ v: <span className="font-medium text-foreground [overflow-wrap:anywhere]" /> }}
                />
              </FieldDescription>
              <Input
                id={confirmId}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showNameError || undefined}
                aria-describedby={showNameError ? `${confirmId}-hint ${confirmId}-error` : `${confirmId}-hint`}
              />
              <SettingsFieldError id={`${confirmId}-error`}>
                {showNameError ? t("org.transfer.confirm_mismatch", { name: organizationName }) : null}
              </SettingsFieldError>
            </Field>
            {passwordless ? (
              // Inserted by a refusal it is an alert; known up front it is a note
              // read with the rest of the dialog.
              <Alert variant="destructiveSoft" role={refusedPasswordless ? "alert" : "note"}>
                <AlertDescription className="text-pretty [overflow-wrap:anywhere]">
                  {t("org.transfer.no_password", { name: organizationName })}
                </AlertDescription>
              </Alert>
            ) : (
              <TransferPasswordField
                id={passwordId}
                value={password}
                onValueChange={changePassword}
                error={passwordError}
              />
            )}
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => changeOpen(false)}
            submitType="submit"
            destructive
            submitLabel={t("org.transfer.action")}
            submittingLabel={t("org.transfer.action_pending")}
            submitting={transfer.isPending}
            submitDisabled={missing !== null}
            reasonId={reasonId}
            leading={
              missing && !transfer.isPending ? (
                <span id={reasonId} className="text-pretty">
                  {missing}
                </span>
              ) : null
            }
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
