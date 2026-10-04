"use client";

/**
 * Design tab body (B1 UI half, UNI-927). The self-contained panel the serialized
 * UI-wire round mounts in the Design tab: theme gallery (`apply_theme`), slide
 * size (`set_slide_size`), background dialog (`set_background`) and layout
 * picker (`set_slide_layout`).
 *
 * Contract. The panel is driven by one optional async port and one optional
 * theme id, and it owns no session, no transport and no save path:
 *
 *   onApplyEdit?(edit: ThemeEdit): Promise<unknown>  // the engine edit channel
 *   onError?(error: unknown): void                   // host reporting seam
 *
 * `onApplyEdit` receives exactly the committed B1e `ThemeEdit` union member, so
 * the wire round is a one-line binding (`(edit) => handle.edit([edit])` or
 * `model.applyEdit(edit)`). With no port bound every control is disabled and the
 * panel says why - it never fakes a capability (the lane's honesty rule).
 *
 * States: loading (a probe is in flight), empty (no deck), ready, busy (an edit
 * is applying), error (the last edit was refused; the message is shown and the
 * document is unchanged). The document is only ever mutated by `onApplyEdit`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { ThemeEdit } from "@uniwork/office-engine/pptx";
import { PptxBackgroundDialog } from "./background-dialog";
import {
  PPTX_DESIGN_THEMES,
  buildBackgroundEdit,
  buildGraphicsHiddenEdit,
  buildLayoutEdit,
  buildSlideSizeEdit,
  buildThemeEdit,
  type PptxDesignBackgroundRequest,
  type PptxDesignLayout,
} from "./design-model";
import { PptxLayoutPicker } from "./layout-picker";
import { PptxSlideSizeControl } from "./slide-size-control";
import { PptxThemeGallery } from "./theme-gallery";

export interface PptxDesignPanelProps {
  /** The engine edit channel (one committed `ThemeEdit` per call). Absent ->
   *  every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: ThemeEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** Deck slide count; 0 means "no deck" and the panel shows its empty state. */
  slideCount?: number;
  /** 0-based selected slide; null when nothing is selected. */
  slideIndex?: number | null;
  /** The deck's current EMU size, for the size readout. */
  slideSize?: { cx: number; cy: number } | null;
  /** Layouts from the host's catalog (`listSlideLayouts`). */
  layouts?: readonly PptxDesignLayout[];
  /** Part path of the selected slide's layout. */
  activeLayoutPath?: string | null;
  /** Id of the deck's current theme, when known. */
  activeThemeId?: string | null;
  /** The selected slide's background seed values, for the dialog fields. */
  background?: { color?: string; from?: string; to?: string; angleDeg?: number; radial?: boolean; tile?: boolean } | null;
  /** Whether the selected slide owns a background (enables Reset). */
  canResetBackground?: boolean;
  /** Whether the selected slide hides the master background graphics. */
  graphicsHidden?: boolean;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

export function PptxDesignPanel({
  onApplyEdit,
  onError,
  slideCount = 0,
  slideIndex = null,
  slideSize = null,
  layouts = [],
  activeLayoutPath = null,
  activeThemeId = null,
  background = null,
  canResetBackground = false,
  graphicsHidden = false,
  loading = false,
  disabled = false,
  className,
}: PptxDesignPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  // Latest busy flag for the synchronous guard: a second click during an
  // in-flight edit must not queue a duplicate transaction.
  const busyRef = useRef(false);

  const bound = typeof onApplyEdit === "function";
  const hasDeck = slideCount > 0;
  const blocked = disabled || !bound || !hasDeck || busy;
  const targets = useMemo(() => (slideIndex === null ? [] : [slideIndex]), [slideIndex]);

  const run = useCallback(
    async (edit: ThemeEdit): Promise<boolean> => {
      if (!onApplyEdit || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        await onApplyEdit(edit);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        onError?.(error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onApplyEdit, onError],
  );

  const applyTheme = useCallback(
    (themeId: string) => {
      const theme = PPTX_DESIGN_THEMES.find((entry) => entry.id === themeId);
      if (!theme) return;
      void run(buildThemeEdit(theme));
    },
    [run],
  );

  const setSize = useCallback(
    (cxEmu: number, cyEmu: number) => {
      void run(buildSlideSizeEdit(cxEmu, cyEmu));
    },
    [run],
  );

  const applyLayout = useCallback(
    (layoutPath: string) => {
      if (slideIndex === null) return;
      void run(buildLayoutEdit(slideIndex, layoutPath));
    },
    [run, slideIndex],
  );

  const resetLayout = useCallback(() => {
    if (slideIndex === null) return;
    void run(buildLayoutEdit(slideIndex));
  }, [run, slideIndex]);

  const applyBackground = useCallback(
    (request: PptxDesignBackgroundRequest) => {
      if (request.slideIndexes.length === 0) return;
      // Close only on a successful apply: a refused edit keeps the dialog open
      // with the fields intact so the user can correct them.
      void run(buildBackgroundEdit(request)).then((applied) => {
        if (applied) setBackgroundOpen(false);
      });
    },
    [run],
  );

  const toggleGraphicsHidden = useCallback(
    (hidden: boolean, slideIndexes: readonly number[]) => {
      if (slideIndexes.length === 0) return;
      void run(buildGraphicsHiddenEdit(hidden, slideIndexes));
    },
    [run],
  );

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("design.loading")}
        data-pptx-design-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div
        data-pptx-design-panel
        data-state="empty"
        className={cn("p-3 text-caption text-muted-foreground", className)}
      >
        {t("design.empty")}
      </div>
    );
  }

  const unboundReason = disabled ? null : !bound ? t("design.unbound") : null;

  return (
    <section
      aria-label={t("design.title")}
      data-pptx-design-panel
      data-state={busy ? "busy" : "ready"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3", className)}
    >
      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-design-error">
          <AlertTitle>{t("design.error_title")}</AlertTitle>
          <AlertDescription>{t("design.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-design-busy">
          {t("design.busy")}
        </p>
      ) : null}

      <PptxThemeGallery activeThemeId={activeThemeId} busy={busy} disabled={blocked} onApplyTheme={applyTheme} />

      <PptxSlideSizeControl size={slideSize} busy={busy} disabled={blocked} onSetSlideSize={setSize} />

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-muted-foreground">{t("design.background_label")}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={blocked || slideIndex === null}
          data-pptx-background-open
          onClick={() => setBackgroundOpen(true)}
        >
          {t("design.background_open")}
        </Button>
      </div>

      <PptxLayoutPicker
        layouts={layouts}
        activeLayoutPath={activeLayoutPath}
        slideIndex={slideIndex}
        busy={busy}
        disabled={blocked}
        onApplyLayout={applyLayout}
        onResetLayout={resetLayout}
      />

      {unboundReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-design-unbound">
          {unboundReason}
        </p>
      ) : null}

      {slideIndex !== null ? (
        <PptxBackgroundDialog
          open={backgroundOpen}
          onOpenChange={setBackgroundOpen}
          slideIndex={slideIndex}
          slideCount={slideCount}
          canReset={canResetBackground}
          graphicsHidden={graphicsHidden}
          initialFill={background}
          busy={busy}
          disabled={disabled || !bound}
          onApply={applyBackground}
          onToggleGraphicsHidden={toggleGraphicsHidden}
        />
      ) : null}
    </section>
  );
}