"use client";

/**
 * A3ui (UNI-927) - the Insert panel: shapes, text box, picture, WordArt,
 * connectors and Group selection in one self-contained surface.
 *
 * Presentational + command-emitting: it owns no editor session and writes
 * nothing. Every action leaves as either
 *   - a registered engine edit (`add_element` / `add_image` / `replace_picture`)
 *     through `onEdit`, or
 *   - a typed request through `onInsertConnector` / `onGroupSelection`
 *     (the `addConnector` / `groupElements` channels the engine half binds).
 *
 * A missing channel disables its control instead of rendering a dead button,
 * and the four states are explicit: no slide bound (empty), loading, a typed
 * error, and busy/disabled with the reason the host supplied.
 *
 * The serialized UI-wire round mounts this component (adds the Insert-tab group
 * + command ids and merges `./insert-i18n` into the two locale files); this file
 * deliberately touches no shared path.
 */
import { useCallback, useState } from "react";
import { Loader2, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_INSERT_PICTURE_BOX,
  PPTX_INSERT_TEXT_BOX_KIND,
  PPTX_INSERT_WORDART_BOX,
  addElementEdit,
  wordArtParagraphs,
  type PptxInsertConnectorRequest,
  type PptxInsertEdit,
  type PptxInsertElementRef,
  type PptxInsertShape,
  type PptxInsertWordArtPreset,
} from "./insert-model";
import { insertShapeEdit, insertTextBoxEdit } from "./insert-defaults";
import { PptxConnectorPicker } from "./pptx-connector-picker";
import { PptxImageInsert, type PptxImageBytes } from "./pptx-image-insert";
import { PptxShapeGallery } from "./pptx-shape-gallery";
import { PptxWordArtPicker } from "./pptx-wordart-picker";

export interface PptxInsertPanelProps {
  /** Current slide, or null when no deck/slide is bound (empty state). */
  slideIndex: number | null;
  /** Top-level elements of the current slide (connector/group pickers). */
  elements?: readonly PptxInsertElementRef[];
  /** Element ids selected on the canvas. */
  selectedIds?: readonly string[];
  /**
   * The selected picture, when the selection is exactly one picture. `null`
   * means the host reports no picture selected, so Replace disables; omit it
   * when the host does not track the picture selection, leaving Replace usable.
   */
  pictureId?: string | null;
  /** The engine render tree is still building. */
  loading?: boolean;
  /** The host refuses every insert (read-only, no edit channel, ...). */
  disabled?: boolean;
  /** Why inserts are unavailable; shown instead of a silent dead control. */
  disabledReason?: string | null;
  /** An insert is in flight. */
  busy?: boolean;
  /** A failure the host already knows about. */
  error?: string | null;
  /** The edit channel. Absent disables the edit-emitting controls. */
  onEdit?: (edit: PptxInsertEdit) => Promise<unknown> | void;
  /** The connector channel (A4e addConnector). */
  onInsertConnector?: (request: PptxInsertConnectorRequest) => Promise<unknown> | void;
  /** The grouping channel (group_elements). */
  onGroupSelection?: (elementIds: readonly string[]) => Promise<unknown> | void;
  className?: string;
}

export function PptxInsertPanel({
  slideIndex,
  elements = [],
  selectedIds = [],
  pictureId,
  loading = false,
  disabled = false,
  disabledReason = null,
  busy = false,
  error = null,
  onEdit,
  onInsertConnector,
  onGroupSelection,
  className,
}: PptxInsertPanelProps) {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState<string | null>(null);
  const noSlide = slideIndex === null;
  const canEdit = Boolean(onEdit) && !noSlide && !disabled && !busy;
  const canConnect = Boolean(onInsertConnector) && !noSlide && !disabled && !busy;
  const canGroup = Boolean(onGroupSelection) && !noSlide && !disabled && !busy;
  const shownError = localError ?? error;
  const hint = noSlide ? t("office.pptx.insert.no_slide") : disabledReason ?? (disabled ? t("office.pptx.insert.disabled_hint") : null);

  const emit = useCallback(
    (edit: PptxInsertEdit) => {
      if (!onEdit || slideIndex === null) return;
      setLocalError(null);
      const result = onEdit(edit);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch((failure: unknown) => {
          setLocalError(failure instanceof Error ? failure.message : String(failure));
        });
      }
    },
    [onEdit, slideIndex],
  );

  const onInsertShape = useCallback(
    (shape: PptxInsertShape) => {
      if (slideIndex === null) return;
      emit(insertShapeEdit(slideIndex, shape.prst));
    },
    [emit, slideIndex],
  );

  const onInsertTextBox = useCallback(() => {
    if (slideIndex === null) return;
    emit(insertTextBoxEdit(slideIndex, t("office.pptx.insert.text_box.placeholder", { defaultValue: t("office.pptx.insert.text_box.title") })));
  }, [emit, slideIndex, t]);

  const onInsertWordArt = useCallback(
    (preset: PptxInsertWordArtPreset, text: string) => {
      if (slideIndex === null) return;
      emit(
        addElementEdit(slideIndex, PPTX_INSERT_TEXT_BOX_KIND, PPTX_INSERT_WORDART_BOX, {
          paragraphs: wordArtParagraphs(preset, text) as Extract<PptxInsertEdit, { op: "add_element" }>["paragraphs"],
        }),
      );
    },
    [emit, slideIndex],
  );

  const onImage = useCallback(
    (mode: "insert" | "replace", file: PptxImageBytes) => {
      if (slideIndex === null) return;
      if (mode === "replace") {
        // Only the Replace control swaps bytes; Insert always adds a new picture,
        // even while a picture happens to be selected on the canvas.
        if (!pictureId) return;
        emit({ op: "replace_picture", slideIndex, elementId: pictureId, bytes: file.bytes, ext: file.ext });
        return;
      }
      emit({ op: "add_image", slideIndex, bytes: file.bytes, ext: file.ext, ...PPTX_INSERT_PICTURE_BOX });
    },
    [emit, pictureId, slideIndex],
  );

  const onConnector = useCallback(
    (request: PptxInsertConnectorRequest) => {
      if (!onInsertConnector || slideIndex === null) return;
      setLocalError(null);
      const result = onInsertConnector({ ...request, slideIndex });
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch((failure: unknown) => {
          setLocalError(failure instanceof Error ? failure.message : String(failure));
        });
      }
    },
    [onInsertConnector, slideIndex],
  );

  const onGroup = useCallback(
    (elementIds: readonly string[]) => {
      if (!onGroupSelection || slideIndex === null) return;
      setLocalError(null);
      const result = onGroupSelection(elementIds);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch((failure: unknown) => {
          setLocalError(failure instanceof Error ? failure.message : String(failure));
        });
      }
    },
    [onGroupSelection, slideIndex],
  );

  if (loading) {
    return (
      <section
        className={cn("flex items-center gap-2 p-3 text-body text-muted-foreground", className)}
        aria-busy="true"
        data-pptx-insert-panel
        data-testid="pptx-insert-panel"
        data-state="loading"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        <span data-pptx-insert-loading data-testid="pptx-insert-loading">{t("office.pptx.insert.loading")}</span>
      </section>
    );
  }

  return (
    <section
      className={cn("flex flex-col gap-3 p-3", className)}
      aria-label={t("office.pptx.insert.title")}
      data-pptx-insert-panel
      data-testid="pptx-insert-panel"
      data-state={noSlide ? "empty" : disabled ? "disabled" : busy ? "busy" : "ready"}
    >
      {shownError ? (
        <Alert variant="destructive" data-pptx-insert-error data-testid="pptx-insert-error">
          <AlertTitle>{t("office.pptx.insert.error_title")}</AlertTitle>
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      ) : null}

      {hint ? (
        <p className="text-caption text-muted-foreground" data-pptx-insert-hint data-testid="pptx-insert-hint">
          {hint}
        </p>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-pptx-insert-busy data-testid="pptx-insert-busy">
          {t("office.pptx.insert.busy")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("office.pptx.insert.sections_label")}>
        <PptxShapeGallery disabled={!canEdit} busy={busy} onInsert={onInsertShape} />
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          disabled={!canEdit}
          aria-label={t("office.pptx.insert.text_box.insert")}
          title={t("office.pptx.insert.text_box.hint")}
          data-pptx-insert-text-box
          data-testid="pptx-insert-text-box"
          onClick={onInsertTextBox}
        >
          <Type aria-hidden="true" />
          <span className="text-label">{t("office.pptx.insert.text_box.insert")}</span>
        </Button>
        <PptxImageInsert
          mode="insert"
          disabled={!canEdit}
          busy={busy}
          onSelect={onImage}
        />
        <PptxImageInsert
          mode="replace"
          disabled={!canEdit}
          busy={busy}
          targetId={pictureId}
          onSelect={onImage}
        />
        <PptxWordArtPicker
          disabled={!canEdit}
          busy={busy}
          defaultText={t("office.pptx.insert.wordart.text_placeholder")}
          onInsert={onInsertWordArt}
        />
      </div>

      <div className="border-t border-border pt-3">
        <PptxConnectorPicker
          elements={elements}
          selectedIds={selectedIds}
          connectorDisabled={!canConnect}
          groupDisabled={!canGroup}
          busy={busy}
          onInsertConnector={onConnector}
          onGroupSelection={onGroup}
        />
      </div>
    </section>
  );
}