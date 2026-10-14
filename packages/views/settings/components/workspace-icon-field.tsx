"use client";

import { ImageUp, FaceSlightlySmilingPlus, Trash2 } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Workspace } from "@uniwork/core/types";
import { usePatchWorkspace, useRemoveWorkspaceIcon, useUploadWorkspaceIcon } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { WorkspaceIcon } from "../../layout/workspace-icon";
import { toastApiError } from "../../toast-api-error";

// emoji-mart ships its whole dataset; load it when the picker opens.
const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((m) => ({ default: m.EmojiPicker })),
);

/** The image types the workspace_icon files purpose accepts. */
const ICON_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
/** The server's upload cap for workspace icons (2 MiB). */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

/** Preview plus the three icon actions an owner or admin has (spec §6.4). */
export function WorkspaceIconField({ workspace }: { workspace: Workspace }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = usePatchWorkspace(workspace.organization_slug, workspace.slug);
  const upload = useUploadWorkspaceIcon(workspace.organization_slug, workspace.slug);
  const remove = useRemoveWorkspaceIcon(workspace.organization_slug, workspace.slug);
  const busy = patch.isPending || upload.isPending || remove.isPending;
  const hasIcon = !!workspace.icon_emoji || !!workspace.icon_url;

  const pickEmoji = (emoji: string) => {
    setPickerOpen(false);
    patch.mutate(
      { wsId: workspace.id, icon_emoji: emoji },
      { onError: (err) => toastApiError(err, t("workspace.icon_error")) },
    );
  };

  const uploadFile = (file: File | undefined) => {
    // Clear the input so choosing the same file again still fires change.
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    if (file.size > MAX_ICON_BYTES) {
      toast.error(t("profile.avatarTooLarge"));
      return;
    }
    upload.mutate({ wsId: workspace.id, file }, { onError: (err) => toastApiError(err, t("workspace.icon_upload_error")) });
  };

  return (
    <div className="flex items-center gap-2 sm:justify-end">
      <WorkspaceIcon
        workspace={workspace}
        className="size-10 rounded-lg bg-primary text-title font-semibold text-primary-foreground"
      />
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger render={<Button type="button" variant="outline" size="sm" disabled={busy} />}>
          <FaceSlightlySmilingPlus aria-hidden />
          {t("workspace.icon_pick_emoji")}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Suspense fallback={<div className="h-80 w-72" aria-hidden />}>
            <EmojiPicker onSelect={pickEmoji} />
          </Suspense>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
        <ImageUp aria-hidden />
        {t("workspace.icon_upload")}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept={ICON_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("workspace.icon_upload")}
        onChange={(e) => uploadFile(e.target.files?.[0])}
      />
      {hasIcon ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("workspace.icon_remove")}
          title={t("workspace.icon_remove")}
          disabled={busy}
          onClick={() =>
            remove.mutate({ wsId: workspace.id }, { onError: (err) => toastApiError(err, t("workspace.icon_error")) })
          }
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
