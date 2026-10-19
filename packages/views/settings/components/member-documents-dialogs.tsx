"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@uniwork/core/api";
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

  // The control that had focus (the picker, then the confirm) leaves the page
  // when the lock lands: put focus on the result heading, inside the dialog,
  // so a keyboard or screen-reader user keeps their place for the progress.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (deactivated) heading.current?.focus();
  }, [deactivated]);

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
        {/* After the lock the question is answered: the dialog says what is done. */}
        <AlertDialogTitle ref={heading} tabIndex={-1} className="outline-none">
          {deactivated
            ? t("org.members.transfer_docs.result_title", { name })
            : t("org.members.deactivate_title", { name })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {deactivated
            ? t("org.members.transfer_docs.result_body")
            : t("org.members.deactivate_body", { name })}
        </AlertDialogDescription>
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
  const [phase, setPhase] = useState<TransferPhase>("idle");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || phase !== "busy") onOpenChange(next);
      }}
    >
      {/* The X only while there is something to cancel: the footer already
          closes a finished or empty dialog. */}
      <FormDialogContent showCloseButton={phase === "idle"}>
        {member ? (
          <TransferContent
            orgSlug={orgSlug}
            member={member}
            onPhaseChange={setPhase}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </Dialog>
  );
}

/** What the row dialog is doing: choosing, running, or only waiting to be closed. */
type TransferPhase = "idle" | "busy" | "finished";

function TransferContent({
  orgSlug,
  member,
  onPhaseChange,
  onClose,
}: {
  orgSlug: string;
  member: OrgMember;
  onPhaseChange: (phase: TransferPhase) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = nameOf(member);
  const ownership = useMemberDocumentOwnership(orgSlug, member.user_id);
  const { run, start, retry } = useTransferRun(orgSlug);
  const [pick, setPick] = useState<Pick>(NO_PICK);
  const busy = run.status === "running";
  const total = ownership.data?.total ?? 0;
  // Nothing to move (no documents, or the server says the caller may not act):
  // a confirm could never be pressed, so only the close action is offered.
  const nothingToDo =
    (ownership.data !== undefined && total === 0) ||
    (ownership.error instanceof ApiError && ownership.error.status === 403);
  const phase: TransferPhase = busy ? "busy" : run.status !== "idle" || nothingToDo ? "finished" : "idle";
  useEffect(() => onPhaseChange(phase), [phase, onPhaseChange]);
  const to = recipientOf(pick.value);
  const ready = to !== "" && total > 0 && run.status === "idle";
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
            showTitle={false}
          />
        ) : null}
        <TransferRunStatus run={run} recipientName={pick.label} deactivated onRetry={() => void retry()} />
      </FormDialogBody>
      <DialogFooter className="items-center px-5 py-3">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {phase === "idle" || busy ? t("common.cancel") : t("common.close")}
        </Button>
        {phase === "idle" || busy ? (
          // aria-disabled keeps the button focusable until a recipient is picked
          // and while the batches run.
          <Button
            type="button"
            aria-disabled={!ready || undefined}
            aria-busy={busy || undefined}
            onClick={() => {
              if (ready) void start(member.user_id, to);
            }}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {t("org.members.transfer_docs.confirm")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
