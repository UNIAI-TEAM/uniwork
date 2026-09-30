"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Check, Droplets, ImagePlus } from "lucide-react";
import {
  useMeetingRoomPreferencesStore,
  type MeetingBackgroundPreset,
  MEETING_BACKGROUND_IMAGE_PATHS,
} from "@uniwork/core/meetings/room-preferences";
import { FieldError } from "@uniwork/ui/components/ui/field";
import { cn } from "@uniwork/ui/lib/utils";
import { backgroundImageDataUrl } from "./meeting-background-image";
import { meetingBackgroundActive, supportsBackgroundProcessors } from "./meeting-background-processor";

const ACCEPTED_BACKGROUND_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BACKGROUND_MB = 5;
const MAX_BACKGROUND_BYTES = MAX_BACKGROUND_MB * 1024 * 1024;

function BackgroundTile({
  selected,
  label,
  onSelect,
  dashed = false,
  pressable = true,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  dashed?: boolean;
  /** False for an action tile (upload), which has no on/off state. */
  pressable?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={pressable ? selected : undefined}
      className="group flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg text-left"
    >
      <span
        className={cn(
          "relative block aspect-video overflow-hidden rounded-lg bg-muted transition-[box-shadow,transform] duration-fast",
          "group-hover:ring-2 group-hover:ring-border motion-safe:group-active:scale-[0.97]",
          dashed && "border border-dashed border-border bg-transparent",
          selected &&
            "ring-2 ring-brand ring-offset-2 ring-offset-surface-raised group-hover:ring-brand",
        )}
      >
        {children}
        {selected ? (
          <span className="absolute right-1 bottom-1 flex size-4.5 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <Check aria-hidden className="size-3" strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "truncate px-0.5 text-caption",
          selected ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** Background presets, the viewer's own image and the upload action, as one row of tiles. */
export function MeetingBackgroundPicker() {
  const { t } = useTranslation();
  const headingId = useId();
  const [uploadError, setUploadError] = useState<"invalid" | "save" | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const setBackground = useMeetingRoomPreferencesStore((s) => s.setBackground);
  const setCustomBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.setCustomBackgroundDataUrl);

  // The effects library is only fetched once a background is wanted; until
  // then there is nothing to warn about.
  useEffect(() => {
    if (!meetingBackgroundActive(background)) return;
    let cancelled = false;
    void supportsBackgroundProcessors()
      .then((ok) => !cancelled && setUnsupported(!ok))
      .catch(() => !cancelled && setUnsupported(true));
    return () => {
      cancelled = true;
    };
  }, [background]);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    const accepted = ACCEPTED_BACKGROUND_TYPES.includes(file.type as (typeof ACCEPTED_BACKGROUND_TYPES)[number]);
    if (!accepted || file.size > MAX_BACKGROUND_BYTES) {
      setUploadError("invalid");
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await backgroundImageDataUrl(file);
    } catch {
      setUploadError("invalid");
      return;
    }
    const previous = customBackgroundDataUrl;
    try {
      setCustomBackgroundDataUrl(dataUrl);
      setBackground("custom");
      setUploadError(null);
    } catch {
      // The store persists as it sets; a full localStorage throws after the
      // in-memory update, so put the last image that did fit back.
      try {
        setCustomBackgroundDataUrl(previous);
      } catch {
        // Nothing more to restore; the error below explains what happened.
      }
      setUploadError("save");
    }
  };

  const preset = (value: MeetingBackgroundPreset) => ({
    selected: background === value,
    onSelect: () => setBackground(value),
  });

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <div>
        <h3 id={headingId} className="text-label font-semibold text-foreground">
          {t("meetings.deviceBackgroundTitle")}
        </h3>
        <p className="text-caption text-pretty text-muted-foreground">{t("meetings.deviceBackgroundHint")}</p>
      </div>

      <div
        role="group"
        aria-labelledby={headingId}
        // One row on a laptop, so the picker reads as a strip under the preview.
        style={{ "--tiles": customBackgroundDataUrl ? 6 : 5 } as CSSProperties}
        className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-[repeat(var(--tiles),minmax(0,1fr))]"
      >
        <BackgroundTile label={t("meetings.deviceBackgroundNone")} {...preset("none")}>
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <Ban aria-hidden className="size-5" />
          </span>
        </BackgroundTile>
        <BackgroundTile label={t("meetings.deviceBackgroundBlur")} {...preset("blur")}>
          {/* The blur shown on a real scene, so the tile previews the effect. */}
          <img
            src={MEETING_BACKGROUND_IMAGE_PATHS.classroom}
            alt=""
            className="size-full scale-125 object-cover blur-[3px]"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-7 items-center justify-center rounded-full bg-surface-raised/85 text-foreground">
              <Droplets aria-hidden className="size-4" />
            </span>
          </span>
        </BackgroundTile>
        <BackgroundTile label={t("meetings.deviceBackgroundClassroom")} {...preset("classroom")}>
          <img src={MEETING_BACKGROUND_IMAGE_PATHS.classroom} alt="" className="size-full object-cover" />
        </BackgroundTile>
        <BackgroundTile label={t("meetings.deviceBackgroundNature")} {...preset("nature")}>
          <img src={MEETING_BACKGROUND_IMAGE_PATHS.nature} alt="" className="size-full object-cover" />
        </BackgroundTile>
        {customBackgroundDataUrl ? (
          <BackgroundTile label={t("meetings.deviceBackgroundCustom")} {...preset("custom")}>
            <img src={customBackgroundDataUrl} alt="" className="size-full object-cover" />
          </BackgroundTile>
        ) : null}
        <BackgroundTile
          label={t("meetings.deviceBackgroundUpload")}
          selected={false}
          pressable={false}
          dashed
          onSelect={() => fileInputRef.current?.click()}
        >
          <span className="flex size-full items-center justify-center text-muted-foreground group-hover:text-foreground">
            <ImagePlus aria-hidden className="size-5" />
          </span>
        </BackgroundTile>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        tabIndex={-1}
        aria-label={t("meetings.deviceBackgroundUpload")}
        aria-invalid={uploadError ? true : undefined}
        aria-describedby={uploadError ? "room-background-upload-error" : undefined}
        accept={ACCEPTED_BACKGROUND_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => {
          void onUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {uploadError ? (
        <FieldError id="room-background-upload-error">
          {uploadError === "save"
            ? t("meetings.deviceBackgroundSaveFailed")
            : t("meetings.deviceBackgroundInvalid", { size: MAX_BACKGROUND_MB })}
        </FieldError>
      ) : null}
      {unsupported && meetingBackgroundActive(background) ? (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-caption text-warning-soft-foreground">
          {t("meetings.deviceBackgroundUnsupported")}
        </p>
      ) : null}
    </section>
  );
}
