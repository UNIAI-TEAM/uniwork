"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useOrgMembers, useTransferOwnership } from "@uniwork/core/organizations";
import type { OrgMember } from "@uniwork/core/types/people";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogClose, DialogFooter } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../../common/form-dialog";
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
 * is open (`fetchAll`), so the picker offers everyone. "Nobody" is only ever
 * claimed after the last page.
 */
export function useTransferCandidates(orgSlug: string, fetchAll: boolean): TransferCandidates {
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useOrgMembers(
    orgSlug,
    "active",
  );
  const candidates = useMemo(
    () =>
      (data?.pages ?? []).flatMap((p) => p.members).filter((m) => !m.deactivated_at && m.role !== "owner"),
    [data],
  );
  const wantMore = hasNextPage && !isError && (fetchAll || candidates.length === 0);
  useEffect(() => {
    if (wantMore && !isFetchingNextPage) void fetchNextPage();
  }, [wantMore, isFetchingNextPage, fetchNextPage]);
  return {
    candidates,
    none: !isLoading && !isError && !hasNextPage && candidates.length === 0,
    loading: isLoading || Boolean(wantMore),
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
}) {
  const { t } = useTranslation();
  const transfer = useTransferOwnership(orgSlug);
  const [toUserId, setToUserId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [password, setPassword] = useState("");
  // NFC on both sides: a name typed with a Vietnamese IME can arrive
  // decomposed (NFD) and would never match the stored, composed one.
  const typed = normalize(confirmName);
  const expected = normalize(organizationName);
  const nameMatches = typed === expected;
  // Quiet while the reader is still typing a correct prefix; loud once they
  // leave the field or type something that cannot become the name.
  const showNameError = typed !== "" && !nameMatches && (confirmTouched || !expected.startsWith(typed));
  const ready = toUserId !== "" && nameMatches && password !== "" && !transfer.isPending;

  // Closing forgets everything, so reopening never finds the password or a
  // half-made choice from last time.
  const close = () => {
    setToUserId("");
    setConfirmName("");
    setConfirmTouched(false);
    setPassword("");
    onOpenChange(false);
  };

  const changeOpen = (next: boolean) => {
    if (next) onOpenChange(true);
    else if (!transfer.isPending) close();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    transfer.mutate(
      { toUserId, password },
      {
        onSuccess: () => {
          toast.success(t("org.transfer.done"));
          close();
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <FormDialogContent showCloseButton={!transfer.isPending}>
        <form onSubmit={submit}>
          <FormDialogHeader title={t("org.transfer.confirm_title", { name: organizationName })} />
          <FormDialogBody>
            {/* A warning, not an error: nothing is lost, but it cannot be
                undone alone. `note` keeps it from interrupting on open. */}
            <Alert variant="warning" role="note">
              <TriangleAlert aria-hidden />
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4 text-pretty">
                  {CONSEQUENCES.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
            <TransferCandidateField
              id="transfer-target"
              candidates={candidates}
              value={toUserId}
              onValueChange={setToUserId}
              loading={loadingCandidates}
              isError={candidatesError}
              onRetry={onRetryCandidates}
            />
            <Field>
              <FieldLabel htmlFor="transfer-confirm">{t("org.transfer.confirm_label")}</FieldLabel>
              <FieldDescription id="transfer-confirm-hint">
                <Trans
                  t={t}
                  i18nKey="org.transfer.confirm_prompt"
                  values={{ name: organizationName }}
                  components={{ v: <span className="font-medium text-foreground" /> }}
                />
              </FieldDescription>
              <Input
                id="transfer-confirm"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={showNameError || undefined}
                aria-describedby={showNameError ? "transfer-confirm-hint transfer-confirm-error" : "transfer-confirm-hint"}
              />
              {showNameError ? (
                <SettingsFieldError id="transfer-confirm-error">
                  {t("org.transfer.confirm_mismatch", { name: organizationName })}
                </SettingsFieldError>
              ) : null}
            </Field>
            <TransferPasswordField id="transfer-password" value={password} onValueChange={setPassword} />
          </FormDialogBody>
          <DialogFooter className="items-center px-5 py-3">
            <DialogClose
              render={<Button type="button" variant="outline" aria-disabled={transfer.isPending || undefined} />}
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={!ready || undefined}
              aria-busy={transfer.isPending || undefined}
            >
              {/* Decorative: aria-busy carries the state for assistive tech. */}
              {transfer.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t("org.transfer.action")}
            </Button>
          </DialogFooter>
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
