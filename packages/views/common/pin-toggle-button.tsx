"use client";

import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreatePin, useDeletePin, usePins } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../toast-api-error";

/** Header toggle that pins a task or project to the sidebar's "Pinned" group. */
export function PinToggleButton({
  workspaceId,
  itemType,
  itemId,
  pinLabel,
  unpinLabel,
}: {
  workspaceId: string;
  itemType: "task" | "project";
  itemId: string;
  pinLabel: string;
  unpinLabel: string;
}) {
  const { t } = useTranslation();
  const pins = usePins(workspaceId);
  const createPin = useCreatePin(workspaceId);
  const deletePin = useDeletePin(workspaceId);
  const pinned = (pins.data?.pins ?? []).some((p) => p.item_type === itemType && p.item_id === itemId);
  const pending = createPin.isPending || deletePin.isPending;

  const toggle = () => {
    if (pending) return;
    const mutation = pinned
      ? deletePin.mutateAsync({ itemType, itemId })
      : createPin.mutateAsync({ item_type: itemType, item_id: itemId });
    void mutation.catch((err: unknown) => toastApiError(err, t("common.error")));
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={pinned ? unpinLabel : pinLabel}
      title={pinned ? unpinLabel : pinLabel}
      aria-disabled={pending || undefined}
      className={pinned ? "text-foreground" : "text-muted-foreground"}
      onClick={toggle}
    >
      {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
    </Button>
  );
}
