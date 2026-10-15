"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeactivateOrgMember } from "@uniwork/core/organizations";
import { useMemberDocumentOwnership } from "@uniwork/core/organizations/document-ownership";
import type { OrgMember } from "@uniwork/core/types/people";
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
import { Dialog, DialogFooter } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import { DocumentCountStep, TransferRunStatus, recipientOf, useTransferRun } from "./member-documents-transfer";

type Pick = { value: string; label: string };
const NO_PICK: Pick = { value: "", label: "" };

const nameOf = (member: OrgMember) => member.display_name || member.email;

/**
 * Deactivating a member (DOC-06 §2.2). The account is locked first and the
 * documents move after, in their own calls: locking is a security action that
 * waits for nothing, so the count never gates it and a failed transfer never
 * undoes it. With nobody picked ("Để sau", an unreadable count, no documents)
 * it behaves like the plain confirmation it replaces.
 */
export function DeactivateMemberDialog({
  orgSlug,
  member,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  member: OrgMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      open={open}
      // Neither the lock nor a running transfer is abandoned by a stray Escape.
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        {member ? (
          <DeactivateContent
            orgSlug={orgSlug}
            member={member}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeactivateContent({
  orgSlug,
  member,
  onBusyChange,
  onClose,
}: {
  orgSlug: string;
  member: OrgMember;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = nameOf(member);
  const deactivate = useDeactivateOrgMember(orgSlug);
  const ownership = useMemberDocumentOwnership(orgSlug, member.user_id);
  const { run, start, retry } = useTransferRun(orgSlug);
  const [pick, setPick] = useState<Pick>(NO_PICK);
  const [deactivated, setDeactivated] = useState(false);
  const busy = deactivate.isPending || run.status === "running";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const to = recipientOf(pick.value);

  const confirm = () => {
    if (busy || deactivated) return;
    deactivate.mutate(member.user_id, {
      onSuccess: () => {
        toast.success(t("org.members.deactivated"));
        setDeactivated(true);
        if (!to) {
          onClose();
          return;
        }
        void start(member.user_id, to);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("org.members.deactivate_title", { name })}</AlertDialogTitle>
        <AlertDialogDescription>{t("org.members.deactivate_body", { name })}</AlertDialogDescription>
      </AlertDialogHeader>
      {deactivated ? null : (
        <DocumentCountStep
          orgSlug={orgSlug}
          userId={member.user_id}
          name={name}
          ownership={ownership}
          value={pick.value}
          onValueChange={(value, label) => setPick({ value, label })}
          disabled={busy}
        />
      )}
      <TransferRunStatus run={run} recipientName={pick.label} deactivated={deactivated} onRetry={() => void retry()} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{deactivated ? t("common.close") : t("common.cancel")}</AlertDialogCancel>
        {deactivated ? null : (
          // aria-disabled, not disabled: the button keeps focus and its place in
          // the tab order while the lock and the transfer run (UI Rules).
          <AlertDialogAction
            variant="destructive"
            aria-disabled={busy || undefined}
            aria-busy={deactivate.isPending || undefined}
            onClick={confirm}
          >
            {deactivate.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t("org.members.deactivate")}
          </AlertDialogAction>
        )}
      </AlertDialogFooter>
    </>
  );
}

/**
 * "Chuyển tài liệu" on a deactivated row (§2.2, F-04): the same step, for
 * people deactivated before this existed or whose transfer failed. The member
 * list carries no document counts, so the count is asked when this opens and
 * says so when there is nothing left to move.
 */
export function TransferMemberDocumentsDialog({
  orgSlug,
  member,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  member: OrgMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
    >
      <FormDialogContent showCloseButton={!busy}>
        {member ? (
          <TransferContent
            orgSlug={orgSlug}
            member={member}
            onBusyChange={setBusy}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </Dialog>
  );
}

function TransferContent({
  orgSlug,
  member,
  onBusyChange,
  onClose,
}: {
  orgSlug: string;
  member: OrgMember;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = nameOf(member);
  const ownership = useMemberDocumentOwnership(orgSlug, member.user_id);
  const { run, start, retry } = useTransferRun(orgSlug);
  const [pick, setPick] = useState<Pick>(NO_PICK);
  const busy = run.status === "running";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const to = recipientOf(pick.value);
  const ready = to !== "" && (ownership.data?.total ?? 0) > 0 && run.status === "idle";
  return (
    <>
      <FormDialogHeader title={t("org.members.transfer_docs.action")} description={name} />
      <FormDialogBody>
        {run.status === "idle" ? (
          <DocumentCountStep
            orgSlug={orgSlug}
            userId={member.user_id}
            name={name}
            ownership={ownership}
            value={pick.value}
            onValueChange={(value, label) => setPick({ value, label })}
            showNone
          />
        ) : null}
        <TransferRunStatus run={run} recipientName={pick.label} deactivated onRetry={() => void retry()} />
      </FormDialogBody>
      <DialogFooter className="items-center px-5 py-3">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {run.status === "idle" ? t("common.cancel") : t("common.close")}
        </Button>
        {run.status === "idle" ? (
          // aria-disabled keeps the button focusable until a recipient is picked.
          <Button
            type="button"
            aria-disabled={!ready || undefined}
            aria-busy={busy || undefined}
            onClick={() => {
              if (ready) void start(member.user_id, to);
            }}
          >
            {t("org.members.transfer_docs.confirm")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
