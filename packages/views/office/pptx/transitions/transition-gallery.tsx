"use client";

/**
 * B4ui (UNI-927) - the Transitions tab's transition gallery.
 *
 * A self-contained presentational surface: it owns no edit port and never
 * writes the deck. The caller (the panel, or the later UI-wire round) hands it
 * the current kind and receives the picked kind back through `onPick`, so the
 * only write path stays the caller's single bound edit channel.
 *
 * The kind list is the B4e module's exported PPTX_TRANSITION_KINDS - the panel
 * never re-declares the vendored vocabulary, so a drift there is a compile
 * error here rather than a silently missing tile.
 *
 * States: `disabled` (no slide selected / read-only / no edit port) disables
 * every tile instead of hiding the gallery, so the tab is never an empty
 * mystery. Keyboard: the tiles are one ToggleGroup, so Tab enters it once and
 * the arrow keys move between kinds (the roving behaviour the group owns).
 */
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { PPTX_TRANSITION_KINDS, type PptxTransitionKind } from "@uniwork/office-engine/pptx";

/** The i18n key for one transition kind's label: office.pptx.transitions.kind.<kind>. */
export function transitionKindLabelKey(kind: PptxTransitionKind): string {
  return "kind." + kind;
}

/** Whether a candidate string is a transition kind the gallery can render.
 * Used by the panel to decide if a reported current kind is a real tile; an
 * unknown value is reported as "none" instead of an unlabelled selection. */
export function isPptxTransitionKind(value: unknown): value is PptxTransitionKind {
  return typeof value === "string" && (PPTX_TRANSITION_KINDS as readonly string[]).includes(value);
}

/** The kind a gallery should show as selected: the reported kind when it is a
 * real tile, otherwise "none". Pure, so the panel's read path is testable. */
export function resolveSelectedKind(kind: unknown): PptxTransitionKind {
  return isPptxTransitionKind(kind) ? kind : "none";
}

export interface PptxTransitionGalleryProps {
  /** Current slide's transition kind; an unknown value resolves to "none". */
  currentKind?: PptxTransitionKind | null;
  /** Picked a kind. Absent (or `disabled`) leaves the gallery read-only. */
  onPick?: (kind: PptxTransitionKind) => void;
  /** No edit port, no slide, or a read-only document: every tile is disabled. */
  disabled?: boolean;
  className?: string;
}

export function PptxTransitionGallery({ currentKind, onPick, disabled = false, className }: PptxTransitionGalleryProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.transitions" });
  const selected = resolveSelectedKind(currentKind);
  const interactive = !disabled && typeof onPick === "function";
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-pptx-transition-gallery>
      <span className="text-caption text-muted-foreground">{t("gallery_hint")}</span>
      <ToggleGroup
        aria-label={t("gallery_label")}
        value={[selected]}
        // A single-select gallery: the last pressed value wins. Base UI hands
        // back the whole pressed set, so the newest entry is the pick.
        onValueChange={(values) => {
          if (!interactive) return;
          const next = values[values.length - 1];
          if (next !== undefined && isPptxTransitionKind(next)) onPick?.(next);
        }}
        spacing={1}
        className="flex flex-wrap gap-1"
        data-pptx-transition-gallery-items
      >
        {PPTX_TRANSITION_KINDS.map((kind) => (
          <ToggleGroupItem
            key={kind}
            value={kind}
            disabled={!interactive}
            aria-label={t(transitionKindLabelKey(kind))}
            data-transition-kind={kind}
            data-selected={kind === selected}
            className="h-auto min-w-16 flex-col gap-1 px-2 py-1.5"
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/40 text-caption text-muted-foreground" aria-hidden="true">
              {transitionKindGlyph(kind)}
            </span>
            <span className="text-caption">{t(transitionKindLabelKey(kind))}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** A short decorative mark for a tile: the kind's first letter is enough to
 * distinguish the tiles without pretending to be a preview (the real preview
 * is the slideshow's job). Kept ASCII and uppercase. */
export function transitionKindGlyph(kind: PptxTransitionKind): string {
  return kind.slice(0, 1).toUpperCase();
}
