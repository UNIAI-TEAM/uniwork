"use client";

import { Camera, ImageUp, Trash2 } from "lucide-react";
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

/** The quiet tile every icon row shows; the read-only row uses it too. */
export const WORKSPACE_ICON_TILE = "size-10 rounded-lg bg-muted text-title font-semibold text-foreground";

/**
 * The icon itself is the button: clicking it opens a popover holding the
 * three icon actions (spec §6.4). The camera badge says it can be changed,
 * as on the profile avatar.
 */
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
      toast.error(t("workspace.icon_too_large"));
      return;
    }
    upload.mutate({ wsId: workspace.id, file }, { onError: (err) => toastApiError(err, t("workspace.icon_upload_error")) });
  };

  const pickImage = () => {
    setPickerOpen(false);
    fileInput.current?.click();
  };

  const removeIcon = () => {
    setPickerOpen(false);
    remove.mutate({ wsId: workspace.id }, { onError: (err) => toastApiError(err, t("workspace.icon_error")) });
  };

  return (
    <div className="flex items-center sm:justify-end">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger
          disabled={busy}
          aria-label={t("workspace.icon_change")}
          title={t("workspace.icon_change")}
          className="group relative shrink-0 cursor-pointer rounded-lg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <WorkspaceIcon
            workspace={workspace}
            className={`${WORKSPACE_ICON_TILE} transition-colors group-hover:bg-surface-hover`}
          />
          <span
            aria-hidden
            className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-card bg-muted text-muted-foreground"
          >
            <Camera className="size-3" />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Suspense fallback={<div className="h-80 w-72" aria-hidden />}>
            <EmojiPicker onSelect={pickEmoji} />
          </Suspense>
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" onClick={pickImage}>
              <ImageUp aria-hidden />
              {t("workspace.icon_upload")}
            </Button>
            {hasIcon ? (
              <Button type="button" variant="ghost" size="sm" onClick={removeIcon}>
                <Trash2 aria-hidden />
                {t("workspace.icon_remove")}
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <input
        ref={fileInput}
        type="file"
        accept={ICON_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t("workspace.icon_upload")}
        onChange={(e) => uploadFile(e.target.files?.[0])}
      />
    </div>
  );
}
