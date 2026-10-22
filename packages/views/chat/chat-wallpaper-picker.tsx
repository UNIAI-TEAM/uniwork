"use client";

import { useId, useRef, useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useChatRooms,
  useUpdateChatRoomWallpaper,
  useUploadChatRoomWallpaper,
} from "@uniwork/core/chat";
import {
  CHAT_WALLPAPER_PRESET_IDS,
  type ChatWallpaper,
  type ChatWallpaperPresetId,
  MAX_CHAT_WALLPAPER_BYTES,
} from "@uniwork/core/chat/chat-wallpaper";
import { chatWallpaperFromRoom } from "@uniwork/core/chat/chat-wallpaper-from-room";
import { resolveChatWallSurface } from "@uniwork/core/chat/chat-wallpaper-resolve";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

function isSelected(wallpaper: ChatWallpaper, preset: ChatWallpaperPresetId): boolean {
  if (preset === "default") return wallpaper.type === "default";
  return wallpaper.type === "preset" && wallpaper.id === preset;
}

function PresetTile({
  id,
  label,
  selected,
  disabled,
  onSelect,
}: {
  id: ChatWallpaperPresetId;
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const surface = resolveChatWallSurface(id === "default" ? { type: "default" } : { type: "preset", id });
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-xl border-2 transition-shadow duration-(--duration-fast)",
        selected ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-muted-foreground/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="absolute inset-0" style={surface.style} aria-hidden />
      <span className={cn("absolute inset-0", surface.className)} aria-hidden />
      {selected ? (
        <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
          <Check aria-hidden className="size-3.5" />
        </span>
      ) : null}
    </button>
  );
}

/** Preset grid + custom upload; changes sync to every member via the server. */
export function ChatWallpaperPicker({
  workspaceId,
  roomId,
  canEdit,
  className,
}: {
  workspaceId: string;
  roomId: string;
  canEdit: boolean;
  className?: string;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.preferences" });
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: rooms } = useChatRooms(workspaceId);
  const room = rooms?.find((entry) => entry.id === roomId);
  const wallpaper = chatWallpaperFromRoom(room);
  const setPreset = useUpdateChatRoomWallpaper(workspaceId);
  const uploadWallpaper = useUploadChatRoomWallpaper(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const busy = setPreset.isPending || uploadWallpaper.isPending;

  const onFile = async (file: File | undefined) => {
    if (!file || !canEdit) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(t("chatWallpaper_not_image"));
      return;
    }
    if (file.size > MAX_CHAT_WALLPAPER_BYTES) {
      setError(t("chatWallpaper_too_large"));
      return;
    }
    try {
      await uploadWallpaper.mutateAsync({ roomId, file });
    } catch {
      setError(t("chatWallpaper_save_failed"));
    }
  };

  const customSelected = wallpaper.type === "custom";

  return (
    <div className={className}>
      <p className="mb-3 text-caption text-muted-foreground">
        {canEdit ? t("chatWallpaperSharedHint") : t("chatWallpaperModeratorOnlyHint")}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CHAT_WALLPAPER_PRESET_IDS.map((id) => (
          <PresetTile
            key={id}
            id={id}
            label={t(`chatWallpaperPresets.${id}`)}
            selected={isSelected(wallpaper, id)}
            disabled={!canEdit || busy}
            onSelect={() => {
              void setPreset.mutateAsync({ roomId, preset: id });
            }}
          />
        ))}
        <button
          type="button"
          disabled={!canEdit || busy}
          aria-pressed={customSelected}
          aria-label={t("chatWallpaper_upload")}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "relative flex aspect-[4/3] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed text-label transition-colors duration-(--duration-fast)",
            customSelected ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-muted-foreground/40",
            (!canEdit || busy) && "cursor-not-allowed opacity-50",
          )}
        >
          {customSelected ? (
            <>
              <span className="absolute inset-0" style={resolveChatWallSurface(wallpaper).style} aria-hidden />
              <span className={cn("absolute inset-0", resolveChatWallSurface(wallpaper).className)} aria-hidden />
            </>
          ) : (
            <ImagePlus aria-hidden className="size-6 text-muted-foreground" />
          )}
          <span className="relative z-1 px-2 text-center text-pretty">{t("chatWallpaper_upload")}</span>
          {customSelected ? (
            <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
              <Check aria-hidden className="size-3.5" />
            </span>
          ) : null}
        </button>
      </div>
      <input
        id={inputId}
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={!canEdit || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file);
        }}
      />
      {error ? (
        <p role="alert" className="mt-3 text-caption text-destructive">
          {error}
        </p>
      ) : null}
      {canEdit && wallpaper.type !== "default" ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void setPreset.mutateAsync({ roomId, preset: "default" });
            }}
          >
            {t("chatWallpaper_reset")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
