"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrgMembers, useTransferOwnership } from "@uniwork/core/organizations";
import type { OrgMember } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { SettingsFieldError, SettingsLoadError } from "./settings-layout";

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
      <DialogContent showCloseButton={!transfer.isPending}>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("org.transfer.title")}</DialogTitle>
            <DialogDescription>{t("org.transfer.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Field>
              <FieldLabel htmlFor="transfer-target">{t("org.transfer.new_owner")}</FieldLabel>
              <Select
                id="transfer-target"
                aria-label={t("org.transfer.new_owner")}
                value={toUserId}
                onValueChange={(v) => setToUserId((v as string) ?? "")}
                items={candidates.map((m) => ({
                  value: m.user_id,
                  label: m.display_name || m.email,
                }))}
              />
              {candidatesError ? (
                <SettingsLoadError onRetry={onRetryCandidates}>{t("org.transfer.candidates_error")}</SettingsLoadError>
              ) : loadingCandidates ? (
                <FieldDescription role="status">{t("org.transfer.loading_candidates")}</FieldDescription>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-confirm">{t("org.transfer.confirm_label")}</FieldLabel>
              <Input
                id="transfer-confirm"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                onBlur={() => setConfirmTouched(true)}
                autoComplete="off"
                aria-invalid={showNameError || undefined}
                aria-describedby={showNameError ? "transfer-confirm-hint transfer-confirm-error" : "transfer-confirm-hint"}
              />
              <FieldDescription id="transfer-confirm-hint">
                {t("org.transfer.confirm_hint", { name: organizationName })}
              </FieldDescription>
              {showNameError ? (
                <SettingsFieldError id="transfer-confirm-error">
                  {t("org.transfer.confirm_mismatch", { name: organizationName })}
                </SettingsFieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-password">{t("org.transfer.password_label")}</FieldLabel>
              <Input
                id="transfer-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          </div>
          <DialogFooter showCloseButton={false}>
            <DialogClose
              render={<Button type="button" variant="ghost" aria-disabled={transfer.isPending || undefined} />}
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              aria-disabled={!ready || undefined}
              aria-busy={transfer.isPending || undefined}
            >
              {t("org.transfer.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
