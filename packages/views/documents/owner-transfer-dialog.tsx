"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { readAdminScopeFake } from "@uniwork/core/documents/doc05-fake";
import { useTransferDocumentOwner } from "@uniwork/core/documents/hooks-owner";
import type { OrgMember } from "@uniwork/core/types/people";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { PersonCombobox, type PersonOption } from "../common/person-combobox";
import { useWorkspace } from "../layout/workspace-context";
import type { ShareDialogTarget } from "./share-dialog-target";

/**
 * What the previous owner keeps. `comment` joins once DOC-05 (a) ships the
 * comment level on the server (access addendum §2.1, §6); edit is the default
 * (user decision Q2: a transfer hands over responsibility, not the work).
 */
const KEEP_LEVELS = ["edit", "view", "none"] as const;
type KeepLevel = (typeof KEEP_LEVELS)[number];

export interface OwnerTransferActionProps {
  wsId: string;
  doc: ShareDialogTarget;
  /** The current ACL owner, from the access list. */
  ownerId: string;
  ownerName: string;
  /** Active organization members, already loaded by the share dialog. */
  orgMembers: readonly OrgMember[];
}

/**
 * "Transfer ownership" on the share dialog's owner row (access addendum
 * §2.4; W-DOC06, UNI-1630). The caller already passed canAdministerDocument;
 * a work-product document never gets here (the dialog hides itself).
 */
export function OwnerTransferAction(props: OwnerTransferActionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={opener}
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t("documents.share.owner.transfer_button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Focus goes back to the owner row's button, not the share dialog's
            start. The form lives in the popup, which unmounts when closed, so
            every opening starts from the defaults. */}
        <DialogContent className="sm:max-w-md" closeLabel={t("common.close")} finalFocus={opener}>
          <OwnerTransferForm {...props} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function OwnerTransferForm({
  wsId,
  doc,
  ownerId,
  ownerName,
  orgMembers,
  onClose,
}: OwnerTransferActionProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useWorkspace();
  const wsMembers = useMembers(wsId);
  const transfer = useTransferDocumentOwner(wsId, doc.id);
  const [picked, setPicked] = useState<PersonOption | null>(null);
  const [keep, setKeep] = useState<KeepLevel>("edit");
  const [error, setError] = useState<string | null>(null);

  // An admin reaching a restricted document only through admin_scope may not
  // take it for themselves (DOC-05; the server answers break_glass_required).
  const selfExcluded = readAdminScopeFake(doc) && doc.my_level !== "manage" && doc.visibility === "restricted";

  // Workspace members who are still active in the organization: agents are
  // never workspace members, a deactivated person is absent from the active
  // list, and the current owner is not a transfer.
  const candidates = useMemo<PersonOption[]>(() => {
    const active = new Map(orgMembers.map((m) => [m.user_id, m]));
    return (wsMembers.data ?? [])
      .filter((m) => m.user_id !== ownerId && active.has(m.user_id))
      .filter((m) => !(selfExcluded && m.user_id === user.id))
      .map((m) => {
        const org = active.get(m.user_id);
        return {
          id: m.user_id,
          name: org?.display_name || m.display_name || m.email,
          email: org?.email || m.email,
        };
      });
  }, [orgMembers, wsMembers.data, ownerId, selfExcluded, user.id]);

  const submit = async () => {
    if (!picked || transfer.isPending) return;
    setError(null);
    try {
      await transfer.mutateAsync({ user_id: picked.id, previous_owner_level: keep });
      toast.success(t("documents.share.owner.transferred", { name: picked.name }));
      onClose();
    } catch (err) {
      const code = errorCode(err);
      setError(
        code === "owner_target_not_member"
          ? t("documents.share.owner.target_not_member", { name: picked.name })
          : code === "break_glass_required"
            ? t("documents.share.owner.self_transfer_error")
            : apiErrorMessage(err) ?? t("documents.share.owner.failed"),
      );
    }
  };

  const keepLabel = (value: KeepLevel) =>
    value === "none" ? t("documents.share.owner.previous_level_none") : t(`documents.share.level_${value}`);
  const blocked = !picked || transfer.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {doc.title
            ? t("documents.share.owner.transfer_title", { document: doc.title })
            : t("documents.share.owner.title_untitled")}
        </DialogTitle>
        <DialogDescription>{t("documents.share.owner.transfer_note")}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-transfer-target">{t("documents.share.owner.new_owner_label")}</Label>
          <PersonCombobox
            id="owner-transfer-target"
            options={candidates}
            value={picked}
            onValueChange={(next) => {
              setPicked(next);
              setError(null);
            }}
            placeholder={t("documents.share.owner.search_placeholder")}
            emptyLabel={wsMembers.isPending ? t("common.loading") : t("documents.share.owner.no_candidates")}
            disabled={transfer.isPending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-transfer-keep">
            {t("documents.share.owner.previous_level_label", { name: ownerName })}
          </Label>
          <Select
            items={KEEP_LEVELS.map((value) => ({ value, label: keepLabel(value) }))}
            value={keep}
            onValueChange={(next) => setKeep(next as KeepLevel)}
            disabled={transfer.isPending}
          >
            <SelectTrigger id="owner-transfer-keep" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEEP_LEVELS.map((value) => (
                <SelectItem key={value} value={value}>
                  {keepLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={transfer.isPending} onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {/* aria-disabled keeps the button in the tab order while it waits. */}
        <Button
          type="button"
          aria-disabled={blocked || undefined}
          aria-busy={transfer.isPending || undefined}
          onClick={() => void submit()}
        >
          {transfer.isPending ? <Spinner aria-hidden role="presentation" /> : null}
          {t("documents.share.owner.transfer_confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
