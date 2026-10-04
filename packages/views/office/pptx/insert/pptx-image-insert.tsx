"use client";

/**
 * A3ui (UNI-927) - Insert > Picture, and the Replace-picture action.
 *
 * One component, two modes, because the flow is identical (pick a file, read it
 * to bytes, hand the bytes to the host) and only the emitted edit differs:
 *
 *   insert  -> `add_image`      { slideIndex, bytes, ext, box }
 *   replace -> `replace_picture` { slideIndex, elementId, bytes, ext }
 *
 * The component reads the file in the renderer (no Node, no upload) and refuses
 * an unsupported extension BEFORE the engine sees it, so the user gets a typed
 * message instead of a failed transaction.
 */
import { useRef, useState } from "react";
import { ImagePlus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_IMAGE_ACCEPT, imageExtFromName } from "./insert-model";

/** The bytes + extension the engine kinds take. */
export interface PptxImageBytes {
  bytes: Uint8Array;
  ext: string;
  name: string;
}

export interface PptxImageInsertProps {
  /** `insert` adds a picture; `replace` swaps the selected picture's bytes. */
  mode: "insert" | "replace";
  disabled?: boolean;
  busy?: boolean;
  /** Replace mode only: the picture to swap; absent leaves the action honest. */
  targetId?: string | null;
  onSelect: (file: PptxImageBytes) => void;
  className?: string;
}

export function PptxImageInsert({ mode, disabled = false, busy = false, targetId = null, onSelect, className }: PptxImageInsertProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const replace = mode === "replace";
  const noTarget = replace && !targetId;
  const blocked = disabled || busy || noTarget;
  const label = replace ? t("insert.image.replace") : t("insert.image.insert");
  const hint = noTarget ? t("insert.image.no_target") : replace ? t("insert.image.replace_hint") : null;

  const readFile = async (file: File): Promise<void> => {
    const ext = imageExtFromName(file.name);
    if (!ext) {
      const given = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : file.name;
      setError(t("insert.image.unsupported", { ext: given }));
      return;
    }
    setError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) {
      setError(t("insert.image.unsupported", { ext }));
      return;
    }
    onSelect({ bytes, ext, name: file.name });
  };

  return (
    <div className={cn("inline-flex flex-col gap-1", className)}>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        disabled={blocked}
        aria-label={label}
        title={hint ?? label}
        aria-describedby={hint ? `pptx-image-hint-${mode}` : undefined}
        data-pptx-image-action={mode}
        onClick={() => inputRef.current?.click()}
      >
        {replace ? <RefreshCw aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
        <span className="text-label">{label}</span>
      </Button>
      {hint ? (
        <span id={`pptx-image-hint-${mode}`} className="px-1 text-caption text-muted-foreground" data-pptx-image-hint>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="px-1 text-caption text-destructive" data-pptx-image-error>
          {error}
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={PPTX_IMAGE_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-pptx-image-input={mode}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset first so picking the same file twice still fires a change.
          event.target.value = "";
          if (file) void readFile(file);
        }}
      />
    </div>
  );
}