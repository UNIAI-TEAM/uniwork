"use client";
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParticipants, useTransferHost } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
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
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { toastApiError } from "../toast-api-error";

/**
 * Inline "hand the host role to …" control: a picker of active participants
 * and a confirm step. Renders bare so the parent decides the surface.
 */
export function TransferHostDialog({ workspaceId, meeting }: { workspaceId: string; meeting: Meeting }) {
  const { t } = useTranslation();
  const { data: members } = useMembers(workspaceId);
  const { data: participants } = useParticipants(meeting.id);
  const transfer = useTransferHost(workspaceId, meeting.id);
  const [userId, setUserId] = useState("");
  const [open, setOpen] = useState(false);
  const eligible = (members ?? []).filter((m) => {
    if (m.user_id === meeting.host_user_id) return false;
    return (participants ?? []).some((p) => p.user_id === m.user_id && p.status === "ACTIVE" && p.principal_type === "USER");
  });
  const selected = eligible.find((m) => m.user_id === userId);

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="transfer-host" className="text-caption text-muted-foreground">
          {t("meetings.transferHostTo")}
        </Label>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Select
              id="transfer-host"
              value={userId}
              onValueChange={(v) => setUserId(v ?? "")}
              items={[
                { value: "", label: t("meetings.transferHostPick") },
                ...eligible.map((m) => ({ value: m.user_id, label: m.display_name })),
              ]}
            />
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={!userId} onClick={() => setOpen(true)}>
            <ArrowRightLeft aria-hidden />
            {t("meetings.transferHost")}
          </Button>
        </div>
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("meetings.transferConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("meetings.transferConfirm", { name: selected?.display_name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={transfer.isPending}
              onClick={() =>
                transfer.mutate(userId, {
                  onSuccess: () => {
                    setOpen(false);
                    setUserId("");
                  },
                  onError: (err) => toastApiError(err, t("common.error")),
                })
              }
            >
              {t("meetings.confirmTransfer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
