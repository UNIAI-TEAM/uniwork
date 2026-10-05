"use client";

/**
 * A2 UI half (UNI-927) - the slide sorter view.
 *
 * A self-contained panel: it owns view state (selection, inline rename, the
 * in-flight guard, the layout picker) and reports every change through ONE
 * `onEdit` channel shaped exactly like the web adapter's `PptxEditorHandle.edit`
 * (`(edits: readonly PptxEdit[]) => Promise<unknown>`), so the serialized UI-wire
 * round only has to pass that handle in. It reads the deck from props - no core
 * store, no engine access - and every edit it sends is a kind the engine half
 * already registered (`move_slide`, `duplicate_slide`, `delete_slide`,
 * `set_slide_hidden`, `add_slide_with_layout`, and the five section kinds).
 *
 * Honesty rules followed from the sibling panels:
 * - no `onEdit` bound => every mutating control is disabled with the reason,
 *   never a dead button that silently does nothing;
 * - `readonly` => the same, with the read-only reason;
 * - a rejected edit surfaces in an `Alert` and the panel stops pretending it applied.
 *
 * Layout picker: the layout catalog comes from the P0-1 artifact's
 * `listSlideLayouts(archive)`. The host passes the result as `layouts`, or hands a
 * `loadLayouts` loader so the catalog is fetched the first time the picker opens
 * (that is where the picker's loading/error states come from).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { PptxEdit, PptxSectionInfo } from "@uniwork/office-engine/pptx";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  addBlankSlideEdit,
  addSectionEdit,
  addSlideEdit,
  deleteSlideEdit,
  duplicateSlideEdit,
  moveSectionEdit,
  moveSlideEdit,
  removeSectionEdit,
  renameSectionEdit,
  setSlideHiddenEdit,
} from "./sorter-edits";
import {
  clampSlideIndex,
  layoutPickerValue,
  nextSectionNumber,
  standardLayoutKey,
  type PptxSorterLayout,
  type PptxSorterSlide,
} from "./sorter-helpers";
import { PptxSortableSlideTile } from "./sortable-slide-tile";
import { PptxSorterSections } from "./sorter-sections";

/** How long a created slide waits for the host to re-read the deck before the selection is dropped. */
const PENDING_SELECT_TTL_MS = 5000;

export interface PptxSorterPanelProps {
  slides: readonly PptxSorterSlide[];
  sections?: readonly PptxSectionInfo[];
  /** Layout catalog from the P0-1 artifact's `listSlideLayouts(archive)`. */
  layouts?: readonly PptxSorterLayout[] | null;
  /** Lazily fetch the catalog the first time the picker opens. */
  loadLayouts?: () => Promise<readonly PptxSorterLayout[]>;
  selectedIndex?: number;
  onSelectSlide?: (index: number) => void;
  /** The one edit channel. Same shape as `PptxEditorHandle.edit`. */
  onEdit?: (edits: readonly PptxEdit[]) => Promise<unknown>;
  /** A read-only deck: every mutating control is disabled with a reason. */
  readonly?: boolean;
  /** The deck is still opening; the grid shows skeletons instead of slides. */
  loading?: boolean;
  /** Deck-level failure to render (open/render error). */
  error?: string | null;
  className?: string;
}

type LayoutsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; layouts: readonly PptxSorterLayout[] }
  | { status: "error"; message: string };

export function PptxSorterPanel({
  slides,
  sections = [],
  layouts = null,
  loadLayouts,
  selectedIndex: controlledIndex,
  onSelectSlide,
  onEdit,
  readonly = false,
  loading = false,
  error = null,
  className,
}: PptxSorterPanelProps) {
  const { t } = useTranslation();
  const [internalIndex, setInternalIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [layoutsState, setLayoutsState] = useState<LayoutsState>(() =>
    layouts ? { status: "ready", layouts } : { status: "idle" },
  );
  const layoutRequest = useRef<Promise<unknown> | null>(null);
  // The slide an applied insert/duplicate created, selected once the deck the
  // host re-reads actually holds it (F-13): selecting before the slide list
  // grows would clamp onto the old last slide. It only applies when the count
  // grows by exactly the one slide the edit added, and expires after a timeout
  // so a host that never re-reads cannot select a stale index later.
  const pendingSelect = useRef<{ target: number; baseCount: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const count = slides.length;
  const countRef = useRef(count);
  countRef.current = count;
  const selectedIndex = clampSlideIndex(controlledIndex ?? internalIndex, count);
  const hasSlides = count > 0;
  const bound = typeof onEdit === "function";
  const disabled = !bound || readonly || pending || !hasSlides;
  const disabledReason = !bound
    ? t("office.pptx.sorter.disabled_unbound")
    : readonly
      ? t("office.pptx.sorter.disabled_readonly")
      : pending
        ? t("office.pptx.sorter.disabled_pending")
        : !hasSlides
          ? t("office.pptx.sorter.disabled_empty")
          : undefined;
  const current = hasSlides ? slides[selectedIndex] : undefined;

  // The engine refuses `delete_slide` on a one-slide deck, so Delete is disabled
  // with its own reason instead of offering a guaranteed refusal.
  const deleteDisabled = disabled || count < 2;
  const deleteReason = disabled ? disabledReason : count < 2 ? t("office.pptx.sorter.disabled_last_slide") : undefined;

  // The catalog the host passed wins; otherwise load it once, on demand. The
  // applied reference is remembered so an inline array prop (a new identity on
  // every parent render) cannot set state in a loop.
  const appliedLayouts = useRef<readonly PptxSorterLayout[] | null>(null);
  useEffect(() => {
    if (!layouts || appliedLayouts.current === layouts) return;
    appliedLayouts.current = layouts;
    setLayoutsState({ status: "ready", layouts });
  }, [layouts]);

  const ensureLayouts = useCallback(() => {
    if (layoutsState.status !== "idle" || !loadLayouts || layoutRequest.current) return;
    setLayoutsState({ status: "loading" });
    const request = loadLayouts();
    layoutRequest.current = request;
    void request.then(
      (loaded) => setLayoutsState({ status: "ready", layouts: loaded }),
      (failure: unknown) =>
        setLayoutsState({
          status: "error",
          message: failure instanceof Error ? failure.message : String(failure),
        }),
    );
  }, [layoutsState.status, loadLayouts]);

  const selectSlide = useCallback(
    (index: number) => {
      const bounded = clampSlideIndex(index, count);
      setInternalIndex(bounded);
      onSelectSlide?.(bounded);
    },
    [count, onSelectSlide],
  );

  const clearPendingSelect = useCallback(() => {
    const waiting = pendingSelect.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pendingSelect.current = null;
  }, []);

  useEffect(() => clearPendingSelect, [clearPendingSelect]);

  useEffect(() => {
    const waiting = pendingSelect.current;
    if (!waiting || count === waiting.baseCount) return;
    clearPendingSelect();
    if (count === waiting.baseCount + 1 && waiting.target < count) selectSlide(waiting.target);
  }, [clearPendingSelect, count, selectSlide]);

  const runEdit = useCallback(
    async (edits: readonly PptxEdit[], selectAfter?: number) => {
      if (!onEdit || edits.length === 0) return;
      setPending(true);
      setEditError(null);
      try {
        await onEdit(edits);
        if (selectAfter !== undefined) {
          // The new slide sits right after the source; if the host already
          // re-read the deck it is selectable now, otherwise the count effect
          // selects it when the longer slide list arrives.
          if (selectAfter < countRef.current) selectSlide(selectAfter);
          else {
            clearPendingSelect();
            pendingSelect.current = {
              target: selectAfter,
              baseCount: countRef.current,
              timer: setTimeout(clearPendingSelect, PENDING_SELECT_TTL_MS),
            };
          }
        }
      } catch (failure) {
        setEditError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setPending(false);
      }
    },
    [clearPendingSelect, onEdit, selectSlide],
  );

  const onReorder = useCallback(
    (from: number, to: number) => {
      const edit = moveSlideEdit(from, to, count);
      if (edit) void runEdit([edit]);
    },
    [count, runEdit],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const from = slides.findIndex((slide) => slide.id === event.active.id);
      const to = event.over ? slides.findIndex((slide) => slide.id === event.over?.id) : -1;
      if (from < 0 || to < 0) return;
      onReorder(from, to);
    },
    [onReorder, slides],
  );

  const addSlide = useCallback(
    (layoutIndex: number) => {
      const value = layoutPickerValue(layoutsState.status === "ready" ? layoutsState.layouts : [], layoutIndex);
      if (value === null) return;
      const edit = addSlideEdit(value, selectedIndex);
      if (edit) void runEdit([edit], selectedIndex + 1);
    },
    [layoutsState, runEdit, selectedIndex],
  );

  const addBlankSlide = useCallback(() => {
    const edit = addBlankSlideEdit(selectedIndex);
    if (edit) void runEdit([edit], selectedIndex + 1);
  }, [runEdit, selectedIndex]);

  const addSection = useCallback(
    (atSlideIndex: number) => {
      const name = t("office.pptx.sections.default_name", { index: nextSectionNumber(sections, count) });
      const edit = addSectionEdit(atSlideIndex, name);
      if (edit) void runEdit([edit]);
    },
    [count, runEdit, sections, t],
  );

  const layoutCatalog = layoutsState.status === "ready" ? layoutsState.layouts : [];
  const layoutLabel = (name: string): string => {
    const key = standardLayoutKey(name);
    return key ? t(key, { defaultValue: name }) : name;
  };

  const grid = useMemo(
    () => (
      <ul
        className="grid min-h-64 shrink-0 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] content-start gap-3 p-1"
        aria-label={t("office.pptx.sorter.grid_label")}
        data-pptx-sorter-grid
      >
        {slides.map((slide, index) => (
          <PptxSortableSlideTile
            key={slide.id}
            slide={slide}
            index={index}
            slideCount={count}
            selected={index === selectedIndex}
            reorderDisabled={disabled || count < 2}
            onSelect={selectSlide}
            onReorder={onReorder}
          />
        ))}
      </ul>
    ),
    [count, disabled, onReorder, selectSlide, selectedIndex, slides, t],
  );

  return (
    <section
      aria-label={t("office.pptx.sorter.label")}
      className={cn("flex min-h-0 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-background p-2", className)}
      data-pptx-sorter-panel
      data-pptx-sorter-pending={pending ? "true" : undefined}
    >
      <header className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="truncate text-title-sm font-medium">{t("office.pptx.sorter.title")}</h2>
        <span className="shrink-0 text-caption text-muted-foreground" data-pptx-sorter-selection>
          {current ? t("office.pptx.sorter.selected", { index: selectedIndex + 1 }) : t("office.pptx.sorter.no_selection")}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("office.pptx.sorter.actions_label")}>
        <DropdownMenu onOpenChange={(open) => { if (open) ensureLayouts(); }}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                aria-label={t("office.pptx.sorter.new_label")}
                data-pptx-sorter-new
              />
            }
          >
            <Plus aria-hidden className="size-3.5" />
            {t("office.pptx.sorter.new")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("office.pptx.sorter.new")}</DropdownMenuLabel>
              <DropdownMenuItem disabled={disabled} onClick={addBlankSlide} data-pptx-sorter-blank>
                {t("office.pptx.sorter.new_blank", { defaultValue: t("office.pptx.sorter.new") })}
              </DropdownMenuItem>
              {layoutsState.status === "ready"
                ? layoutCatalog.map((layout, index) => (
                    <DropdownMenuItem
                      key={`${layout.path}:${index}`}
                      disabled={disabled}
                      onClick={() => addSlide(index)}
                      data-pptx-sorter-layout={index}
                    >
                      {layoutLabel(layout.name)}
                    </DropdownMenuItem>
                  ))
                : null}
            </DropdownMenuGroup>
            {layoutsState.status === "loading" ? (
              <div className="flex flex-col gap-1 p-1" data-pptx-sorter-layouts-loading data-testid="pptx-sorter-layouts-loading">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-6 w-full rounded-sm" />
                ))}
              </div>
            ) : null}
            {layoutsState.status === "error" ? (
              <p className="px-2 py-1 text-caption text-destructive" data-pptx-sorter-layouts-error data-testid="pptx-sorter-layouts-error">
                {t("office.pptx.sorter.error_hint", { message: layoutsState.message })}
              </p>
            ) : null}
            {layoutsState.status === "ready" && layoutCatalog.length === 0 ? (
              <p className="px-2 py-1 text-caption text-muted-foreground">{t("office.pptx.sorter.layouts_empty")}</p>
            ) : null}
            {layoutsState.status === "idle" && !loadLayouts ? (
              <p className="px-2 py-1 text-caption text-muted-foreground">{t("office.pptx.sorter.layouts_unavailable")}</p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          data-pptx-sorter-duplicate
          onClick={() => {
            const edit = duplicateSlideEdit(selectedIndex);
            if (edit) void runEdit([edit], selectedIndex + 1);
          }}
        >
          <Copy aria-hidden className="size-3.5" />
          {t("office.pptx.sorter.duplicate")}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          aria-pressed={current?.hidden === true}
          data-pptx-sorter-visibility
          onClick={() => {
            const edit = setSlideHiddenEdit(selectedIndex, !(current?.hidden === true));
            if (edit) void runEdit([edit]);
          }}
        >
          {current?.hidden ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
          {current?.hidden ? t("office.pptx.sorter.show") : t("office.pptx.sorter.hide")}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={deleteDisabled}
          title={deleteDisabled ? deleteReason : undefined}
          data-pptx-sorter-delete
          onClick={() => {
            const edit = deleteSlideEdit(selectedIndex);
            if (edit) void runEdit([edit]);
          }}
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t("office.pptx.sorter.delete")}
        </Button>
      </div>

      <p className="text-caption text-muted-foreground">{t("office.pptx.sorter.move_hint")}</p>

      {error ? (
        <Alert variant="destructive" role="alert" data-pptx-sorter-error data-testid="pptx-sorter-error">
          <AlertTitle>{t("office.pptx.sorter.error_title")}</AlertTitle>
          <AlertDescription>{t("office.pptx.sorter.error_hint", { message: error })}</AlertDescription>
        </Alert>
      ) : null}
      {editError ? (
        <Alert variant="destructive" role="alert" data-pptx-sorter-edit-error data-testid="pptx-sorter-edit-error">
          <AlertTitle>{t("office.pptx.sorter.error_title")}</AlertTitle>
          <AlertDescription>{t("office.pptx.sorter.error_hint", { message: editError })}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-1" aria-busy="true" aria-label={t("office.pptx.sorter.loading")} data-pptx-sorter-loading data-testid="pptx-sorter-loading">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="aspect-video w-full rounded-md" />
          ))}
        </div>
      ) : !hasSlides ? (
        <p className="px-1 py-4 text-body text-muted-foreground" data-pptx-sorter-empty data-testid="pptx-sorter-empty">
          {t("office.pptx.sorter.empty")}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={slides.map((slide) => slide.id)} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      )}

      <PptxSorterSections
        sections={sections}
        slideCount={count}
        selectedIndex={selectedIndex}
        renamingId={renamingId}
        disabled={disabled}
        disabledReason={disabledReason}
        onStartRename={setRenamingId}
        onCancelRename={() => setRenamingId(null)}
        onRename={(id, name) => {
          setRenamingId(null);
          const edit = renameSectionEdit(id, name);
          if (edit) void runEdit([edit]);
        }}
        onAdd={addSection}
        onRemove={(id) => {
          const edit = removeSectionEdit(id);
          if (edit) void runEdit([edit]);
        }}
        onMove={(id, dir) => {
          const edit = moveSectionEdit(id, dir);
          if (edit) void runEdit([edit]);
        }}
        onSelectSlide={selectSlide}
      />

      {readonly ? <p className="text-caption text-muted-foreground" data-pptx-sorter-readonly data-testid="pptx-sorter-readonly">{t("office.pptx.sorter.readonly")}</p> : null}
      {!bound && hasSlides ? <p className="text-caption text-muted-foreground" data-pptx-sorter-unbound data-testid="pptx-sorter-unbound">{t("office.pptx.sorter.unbound")}</p> : null}
      <span className="sr-only" aria-live="polite" data-pptx-sorter-status data-testid="pptx-sorter-status">
        {pending ? t("office.pptx.sorter.pending") : ""}
      </span>
    </section>
  );
}