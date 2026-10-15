"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { readAdminScopeFake } from "@uniwork/core/documents/doc05-fake";
import { useTransferDocumentOwner } from "@uniwork/core/documents/hooks-owner";
import type { OrgMember } from "@uniwork/core/types/people";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";
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
import { useWorkspace } from "../layout/workspace-context";
import type { ShareDialogTarget } from "./share-dialog-target";

/**
 * What the previous owner keeps. `comment` joins once DOC-05 (a) ships the
 * comment level on the server (access addendum §2.1, §6); edit is the default
 * (user decision Q2: a transfer hands over responsibility, not the work).
 */
const KEEP_LEVELS = ["edit", "view", "none"] as const;
type KeepLevel = (typeof KEEP_LEVELS)[number];

interface Candidate {
  id: string;
  name: string;
  email: string;
}

/** Case- and diacritic-insensitive, so "chi" finds "Chí". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

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
  return (
    <>
      <Button type="button" variant="ghost" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t("documents.share.owner.transfer_button")}
      </Button>
      {/* Mounted while open only, so every opening starts from the defaults. */}
      {open ? <OwnerTransferDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function OwnerTransferDialog({
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
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [input, setInput] = useState("");
  const [keep, setKeep] = useState<KeepLevel>("edit");
  const [error, setError] = useState<string | null>(null);

  // An admin reaching a restricted document only through admin_scope may not
  // take it for themselves (DOC-05; the server answers break_glass_required).
  const selfExcluded = readAdminScopeFake(doc) && doc.my_level !== "manage" && doc.visibility === "restricted";

  // Workspace members who are still active in the organization: agents are
  // never workspace members, a deactivated person is absent from the active
  // list, and the current owner is not a transfer.
  const candidates = useMemo<Candidate[]>(() => {
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
            : apiErrorMessage(err) ?? t("documents.owner_transfer.failed"),
      );
    }
  };

  const keepLabel = (value: KeepLevel) =>
    value === "none" ? t("documents.share.owner.previous_level_none") : t(`documents.share.level_${value}`);
  const blocked = !picked || transfer.isPending;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {doc.title
              ? t("documents.share.owner.transfer_title", { document: doc.title })
              : t("documents.owner_transfer.title_untitled")}
          </DialogTitle>
          <DialogDescription>{t("documents.share.owner.transfer_note")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="owner-transfer-target">{t("documents.share.owner.new_owner_label")}</Label>
            <Combobox
              items={candidates}
              value={picked}
              inputValue={input}
              onInputValueChange={(text) => setInput(text)}
              itemToStringLabel={(o: Candidate) => o.name}
              itemToStringValue={(o: Candidate) => o.id}
              isItemEqualToValue={(a: Candidate, b: Candidate) => a.id === b.id}
              filter={(o: Candidate, query: string) => fold(`${o.name} ${o.email}`).includes(fold(query.trim()))}
              onValueChange={(next: Candidate | null) => {
                setPicked(next);
                setInput(next?.name ?? "");
                setError(null);
              }}
              disabled={transfer.isPending}
            >
              <ComboboxInput
                id="owner-transfer-target"
                className="w-full"
                placeholder={t("documents.owner_transfer.search_placeholder")}
                disabled={transfer.isPending}
              />
              <ComboboxContent>
                <ComboboxEmpty>
                  {wsMembers.isPending ? t("common.loading") : t("documents.owner_transfer.no_candidates")}
                </ComboboxEmpty>
                <ComboboxList>
                  {(o: Candidate) => (
                    <ComboboxItem key={o.id} value={o}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="break-words">{o.name}</span>
                        <span className="truncate text-caption text-muted-foreground">{o.email}</span>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
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
      </DialogContent>
    </Dialog>
  );
}
