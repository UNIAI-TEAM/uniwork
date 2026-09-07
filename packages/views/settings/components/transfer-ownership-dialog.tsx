"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTransferOwnership } from "@uniwork/core/organizations";
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

/**
 * Handing the organization to somebody else. Two deliberate frictions, because
 * the outgoing owner cannot undo this alone: they type the organization's name,
 * and they re-enter their password (OPEN_QUESTIONS P2).
 */
export function TransferOwnershipDialog({
  orgSlug,
  organizationName,
  candidates,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  organizationName: string;
  candidates: OrgMember[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const transfer = useTransferOwnership(orgSlug);
  const [toUserId, setToUserId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const nameMatches = confirmName.trim() === organizationName;
  const ready = toUserId !== "" && nameMatches && password !== "" && !transfer.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    transfer.mutate(
      { toUserId, password },
      {
        onSuccess: () => {
          toast.success(t("org.transfer.done"));
          setPassword("");
          setConfirmName("");
          onOpenChange(false);
        },
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
            </Field>
            <Field>
              <FieldLabel htmlFor="transfer-confirm">{t("org.transfer.confirm_label")}</FieldLabel>
              <Input
                id="transfer-confirm"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
              <FieldDescription>
                {t("org.transfer.confirm_hint", { name: organizationName })}
              </FieldDescription>
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
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!ready}>
              {t("org.transfer.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
