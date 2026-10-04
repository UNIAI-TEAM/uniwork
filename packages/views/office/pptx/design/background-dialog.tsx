"use client";

/**
 * Background dialog (Design tab, `set_background`). A modal with the four fill
 * modes the vendored op supports - solid, gradient, picture, plus reset - the
 * "hide background graphics" toggle, and the "apply to all slides" fan-out.
 *
 * Every control edits LOCAL state; nothing reaches the document until Apply is
 * pressed, so a half-typed colour never becomes an edit and Escape/Close always
 * leaves the deck exactly as it was. The dialog is presentational: it reports a
 * `PptxDesignBackgroundRequest` (fill + target slides + an optional
 * graphics-hidden change) and the panel turns that into the engine edits.
 *
 * Keyboard/roles: `role="dialog"` + `aria-modal`, the fill modes are a
 * radiogroup (arrows/Home/End move), Escape closes, and focus returns to the
 * trigger because the trigger owns that (Base UI's Dialog handles the trap).
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import {
  colorInputValue,
  imageExtension,
  isFillColor,
  nextRovingIndex,
  normalizeHex,
  parseAngleDeg,
  rovingEntryIndex,
  slideIndexRange,
  type PptxDesignBackgroundRequest,
} from "./design-model";

/** The three pickable fill modes (reset is an action, not a mode). */
const FILL_MODES = ["solid", "gradient", "image"] as const;
type FillMode = (typeof FILL_MODES)[number];

export interface PptxBackgroundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 0-based slide the dialog edits. */
  slideIndex: number;
  /** Slide count, for the "apply to all" target range. */
  slideCount: number;
  /** Whether the current slide owns a background (enables Reset). */
  canReset?: boolean;
  /** Whether the master's background graphics are currently hidden. */
  graphicsHidden?: boolean;
  /** Seed values for the fields; a deck with a known fill opens on it. */
  initialFill?: { color?: string; from?: string; to?: string; angleDeg?: number; radial?: boolean; tile?: boolean } | null;
  busy?: boolean;
  disabled?: boolean;
  onApply: (request: PptxDesignBackgroundRequest) => void;
  className?: string;
}

export function PptxBackgroundDialog({
  open,
  onOpenChange,
  slideIndex,
  slideCount,
  canReset = false,
  graphicsHidden = false,
  initialFill = null,
  busy = false,
  disabled = false,
  onApply,
  className,
}: PptxBackgroundDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [mode, setMode] = useState<FillMode>("solid");
  const [solid, setSolid] = useState(initialFill?.color ?? "#FFFFFF");
  const [from, setFrom] = useState(initialFill?.from ?? "#4472C4");
  const [to, setTo] = useState(initialFill?.to ?? "#FFFFFF");
  const [angle, setAngle] = useState(String(initialFill?.angleDeg ?? 0));
  const [radial, setRadial] = useState(initialFill?.radial ?? false);
  const [tile, setTile] = useState(initialFill?.tile ?? false);
  const [applyAll, setApplyAll] = useState(false);
  const [hidden, setHidden] = useState(graphicsHidden);
  const [image, setImage] = useState<{ name: string; ext: string; bytes: Uint8Array } | null>(null);
  const [imageError, setImageError] = useState(false);
  const [focusIndex, setFocusIndex] = useState(() => rovingEntryIndex(FILL_MODES.indexOf(mode), FILL_MODES.length));
  const fileRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const blocked = disabled || busy;

  // Seed the fields on the open transition only: `initialFill` is a fresh
  // object on every parent render, so depending on it alone would wipe what
  // the user is typing.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setSolid(initialFill?.color ?? "#FFFFFF");
    setFrom(initialFill?.from ?? "#4472C4");
    setTo(initialFill?.to ?? "#FFFFFF");
    setAngle(String(initialFill?.angleDeg ?? 0));
    setRadial(initialFill?.radial ?? false);
    setTile(initialFill?.tile ?? false);
    setHidden(graphicsHidden);
    setImage(null);
    setImageError(false);
    setApplyAll(false);
  }, [graphicsHidden, initialFill, open]);

  const targets = applyAll ? slideIndexRange(slideCount) : [slideIndex];
  const solidValid = isFillColor(solid);
  const gradientValid = isFillColor(from) && isFillColor(to);
  const canSubmit = !blocked && (mode === "solid" ? solidValid : mode === "gradient" ? gradientValid : image !== null);

  // The graphics choice is form state too: it travels with the Apply request
  // (and only when it actually changed), so ticking the box and pressing Escape
  // still leaves the deck untouched.
  const graphicsChange = hidden === graphicsHidden ? {} : { graphics: { hidden } };

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "solid") {
      onApply({ fill: { kind: "solid", color: normalizeHex(solid) }, slideIndexes: targets, ...graphicsChange });
    } else if (mode === "gradient") {
      const parsed = parseAngleDeg(angle);
      onApply({
        fill: {
          kind: "gradient",
          from: normalizeHex(from),
          to: normalizeHex(to),
          ...(parsed === null ? {} : { angleDeg: parsed }),
          ...(radial ? { radial: true } : {}),
        },
        slideIndexes: targets,
        ...graphicsChange,
      });
    } else if (image) {
      onApply({
        fill: { kind: "image", bytes: image.bytes, ext: image.ext, ...(tile ? { tile: true } : {}) },
        slideIndexes: targets,
        ...graphicsChange,
      });
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) throw new Error("empty");
      setImage({ name: file.name, ext: imageExtension(file.name, file.type), bytes });
      setImageError(false);
    } catch {
      setImage(null);
      setImageError(true);
    }
  };

  const moveMode = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(index, FILL_MODES.length, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    setMode(FILL_MODES[next] as FillMode);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-fill-mode]")[next]?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("sm:max-w-md", className)} closeLabel={t("design.background_close")} data-pptx-background-dialog>
        <DialogHeader>
          <DialogTitle>{t("design.background_title")}</DialogTitle>
          <DialogDescription>{t("design.background_description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            role="radiogroup"
            aria-label={t("design.fill_group_label")}
            aria-busy={busy || undefined}
            className="flex flex-wrap gap-1"
          >
            {FILL_MODES.map((value, index) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                aria-label={t(`design.fill.${value}`)}
                disabled={blocked}
                tabIndex={index === focusIndex ? 0 : -1}
                data-fill-mode={value}
                onFocus={() => setFocusIndex(index)}
                onKeyDown={(event) => moveMode(event, index)}
                onClick={() => !blocked && setMode(value)}
                className={cn(
                  "rounded-md border border-border bg-background px-2 py-1 text-caption",
                  mode === value && "border-primary ring-1 ring-primary",
                  blocked && "opacity-60",
                )}
              >
                {t(`design.fill.${value}`)}
              </button>
            ))}
          </div>

          {mode === "solid" ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="pptx-bg-solid">{t("design.solid_color")}</Label>
              <input
                id="pptx-bg-solid"
                type="color"
                data-testid="pptx-bg-solid"
                aria-label={t("design.solid_color")}
                disabled={blocked}
                value={colorInputValue(solid, "#FFFFFF")}
                onChange={(event) => setSolid(event.target.value)}
                className="size-8 rounded-md border border-border bg-background"
              />
              <Input
                aria-label={t("design.solid_color")}
                data-testid="pptx-bg-solid-hex"
                disabled={blocked}
                value={solid}
                aria-invalid={solidValid ? undefined : true}
                onChange={(event) => setSolid(event.target.value)}
                className="w-28"
              />
              {solidValid ? null : <span className="text-caption text-destructive">{t("design.invalid_color")}</span>}
            </div>
          ) : null}

          {mode === "gradient" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="pptx-bg-from">{t("design.gradient_from")}</Label>
                <input
                  id="pptx-bg-from"
                  type="color"
                  data-testid="pptx-bg-from"
                  aria-label={t("design.gradient_from")}
                  disabled={blocked}
                  value={colorInputValue(from, "#4472C4")}
                  onChange={(event) => setFrom(event.target.value)}
                  className="size-8 rounded-md border border-border bg-background"
                />
                <Label htmlFor="pptx-bg-to">{t("design.gradient_to")}</Label>
                <input
                  id="pptx-bg-to"
                  type="color"
                  data-testid="pptx-bg-to"
                  aria-label={t("design.gradient_to")}
                  disabled={blocked}
                  value={colorInputValue(to, "#FFFFFF")}
                  onChange={(event) => setTo(event.target.value)}
                  className="size-8 rounded-md border border-border bg-background"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="pptx-bg-angle">{t("design.gradient_angle")}</Label>
                <Input
                  id="pptx-bg-angle"
                  type="number"
                  disabled={blocked}
                  value={angle}
                  onChange={(event) => setAngle(event.target.value)}
                  className="w-20"
                />
                <span className="flex items-center gap-2">
                  <Checkbox
                    id="pptx-bg-radial"
                    checked={radial}
                    disabled={blocked}
                    aria-label={t("design.gradient_radial")}
                    onCheckedChange={(checked) => setRadial(checked === true)}
                  />
                  <Label htmlFor="pptx-bg-radial">{t("design.gradient_radial")}</Label>
                </span>
              </div>
              {gradientValid ? null : <span className="text-caption text-destructive">{t("design.invalid_color")}</span>}
            </div>
          ) : null}

          {mode === "image" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => fileRef.current?.click()}>
                  {t("design.image_choose")}
                </Button>
                <span className="min-w-0 truncate text-caption text-muted-foreground" data-testid="pptx-bg-image-name">
                  {image ? t("design.image_selected", { name: image.name }) : t("design.image_none")}
                </span>
              </div>
              <span className="flex items-center gap-2">
                <Checkbox
                  id="pptx-bg-tile"
                  checked={tile}
                  disabled={blocked}
                  aria-label={t("design.image_tile")}
                  onCheckedChange={(checked) => setTile(checked === true)}
                />
                <Label htmlFor="pptx-bg-tile">{t("design.image_tile")}</Label>
              </span>
              {imageError ? <span role="alert" className="text-caption text-destructive">{t("design.image_read_failed")}</span> : null}
              {/* The visible Choose button is the control; the input itself is
                  hidden and out of the tab order, so it carries no label. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                tabIndex={-1}
                data-testid="pptx-bg-file"
                hidden
                onChange={(event) => { void onFileChange(event); }}
              />
            </div>
          ) : null}

          <span className="flex items-center gap-2">
            <Checkbox
              id="pptx-bg-hide-graphics"
              checked={hidden}
              disabled={blocked}
              aria-label={t("design.hide_graphics")}
              onCheckedChange={(checked) => setHidden(checked === true)}
            />
            <Label htmlFor="pptx-bg-hide-graphics">{t("design.hide_graphics")}</Label>
          </span>

          <span className="flex items-center gap-2">
            <Checkbox
              id="pptx-bg-apply-all"
              checked={applyAll}
              disabled={blocked}
              aria-label={t("design.apply_to_all")}
              onCheckedChange={(checked) => setApplyAll(checked === true)}
            />
            <Label htmlFor="pptx-bg-apply-all">
              {applyAll ? t("design.apply_to_all_hint", { total: slideCount }) : t("design.apply_to_all")}
            </Label>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || !canReset}
            title={t("design.reset_hint")}
            onClick={() => onApply({ fill: { kind: "reset" }, slideIndexes: targets })}
          >
            {t("design.reset")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="pptx-bg-cancel"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("design.background_close")}
          </Button>
          {/* The visible copy flips to "Applying..." while busy, so the
              accessible name is pinned to the action it performs. */}
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            aria-label={t("design.apply")}
            data-testid="pptx-bg-apply"
            onClick={submit}
          >
            {busy ? t("design.busy") : t("design.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}