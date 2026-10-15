"use client";

import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/** The original image, in the chat, instead of a new browser tab. */
export function ChatImagePreviewDialog({
  open,
  name,
  src,
  loading,
  onOpenChange,
}: {
  open: boolean;
  name: string;
  src: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t("chat.message_list.image_preview_close")}
        overlayClassName="bg-black/70"
        className="max-w-[calc(100%-2rem)] bg-surface p-3 sm:max-w-4xl"
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {loading || !src ? (
          <div role="status" className="flex h-64 items-center justify-center">
            <span className="sr-only">{t("chat.message_list.image_preview_loading")}</span>
            <Spinner />
          </div>
        ) : (
          <img src={src} alt={name} className="mx-auto max-h-[80vh] w-full object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}
