"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
// Aliased: the bare name would shadow the global `CSS` (CSS.escape is used
// below, unrelated to dnd-kit).
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  flexRender,
  type ColumnSizingState,
  type Header as TanstackHeader,
  type Row,
  type Table as TanstackTable,
} from "@tanstack/react-table";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { GripVertical } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

// We deliberately use the lower-level shadcn primitives (TableHeader /
// TableBody / TableRow / TableHead / TableCell) but NOT the wrapping
// <Table> component. shadcn's <Table> nests the <table> inside an
// `overflow-x-auto` <div>, which would compete with our outer scroll
// container and pin the horizontal scrollbar to the bottom of the
// table rather than the viewport.
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uniwork/ui/components/ui/table";
import { columnSizeVar, getCellStyle } from "@uniwork/ui/lib/data-table";
import { cn } from "@uniwork/ui/lib/utils";

// Pointer travel that turns a press on the resize handle into a drag. Matches
// the column-reorder sensor's activation distance so both gestures on the same
// header behave alike, and keeps a plain click from committing a width.
const RESIZE_DRAG_THRESHOLD = 4;

// Stands in for @dnd-kit/modifiers' restrictToHorizontalAxis — pulling in the
// whole package for this one function isn't worth the dependency. Zeroing the
// vertical component keeps a column drag from ever visually lifting off the
// header row, even if the pointer drifts.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  table: TanstackTable<TData>;
  // Optional bar shown below the table when ≥1 row is selected. We
  // don't currently use selection — kept on the API surface for parity
  // with Dice UI's component so future row-select features just work.
  actionBar?: React.ReactNode;
  // Override for the empty-state cell text.
  emptyMessage?: React.ReactNode;
  // Called when the user clicks a row (anywhere outside an interactive
  // descendant — buttons / dropdowns inside cells should call
  // event.stopPropagation in their own handlers). Used to navigate to
  // a detail page on row click without nesting an <a> around <tr>,
  // which is invalid HTML. Receives the mouse event so callers can honor
  // modifier keys; middle clicks arrive through the same callback (the
  // caller reads `event.button`).
  onRowClick?: (row: Row<TData>, event: React.MouseEvent) => void;
  // Optional escape hatch for semantic rows such as collapsible group
  // headers. Return null/undefined to use the standard data row renderer.
  renderRow?: (row: Row<TData>) => React.ReactNode;
  // A caller-supplied <tfoot> (summary / quick-create rows, for example).
  footer?: React.ReactNode;
  // Render only the visible row window for large tables. Callers should use
  // this when their rows have a stable height; the footer remains part of the
  // same scroll surface and is reachable after the virtual row space.
  virtualizeRows?: boolean;
  virtualRowHeight?: number;
  virtualOverscan?: number;
  // Column ids that may be dragged to a new position, in the caller's
  // current visible order. A grip renders only on headers whose id is in
  // this list; every other header (row-select, the primary title column,
  // a trailing "add column" affordance, …) renders exactly as it does today.
  reorderableColumnIds?: string[];
  // Fired once a drag (pointer or keyboard) completes over a different
  // column than it started on. The caller owns reordering its own column
  // list — this component never reorders `table` itself.
  onColumnReorder?: (activeId: string, overId: string) => void;
  // aria-label for a column's reorder grip. Required in practice whenever
  // onColumnReorder is set — undocumented columns fall back to a generic
  // label built from the column id.
  reorderHandleLabel?: (columnId: string) => string;
  // "full" rules every cell on both axes. "horizontal" drops the vertical
  // rules — a dense list reads along the row, and a rule between every
  // column competes with the content — and lightens the row rules; the frozen
  // block keeps its trailing edge so the boundary stays visible.
  gridLines?: DataTableGridLines;
  // Extra classes for standard data rows (not rows from renderRow). A caller
  // that virtualizes pins the row height here to match `virtualRowHeight`.
  rowClassName?: string;
  // The scroll surface returns to the top whenever this changes — callers
  // pass their query's identity (sort, search, grouping, filter) so a new
  // result opens at its first row. Undefined never scrolls.
  scrollResetKey?: string;
}

type DataTableGridLines = "full" | "horizontal";

// The vertical rule on a header or body cell. Pinned-edge cells keep theirs in
// every mode: it is the one line that says where the frozen block ends.
function cellRuleClass(gridLines: DataTableGridLines, isPinnedEdge: boolean) {
  if (gridLines === "full") return "border-r last:border-r-0";
  // The semantic token, not the inherited currentColor a bare `border-r`
  // resolves to, which reads as a near-black rule.
  return isPinnedEdge ? "border-r border-border" : undefined;
}

// Headless data-table shell — adapted from Dice UI's data-table
// registry (https://diceui.com/r/data-table). Renders a TanStack Table
// instance using shadcn/ui's table primitives.
//
// Layout behaviour:
//   - `w-full` + `table-fixed` keeps the table at viewport width and
//     makes each column's width come from its first row's <th>
//     inline width. column.size is authoritative for sized columns.
//   - Columns flagged `meta.grow: true` skip their inline width, so
//     fixed table-layout assigns them the leftover space until the user
//     resizes them. Once resized, the explicit width is applied.
//   - The table's `min-width` is the sum of every column's TanStack
//     size (`table.getTotalSize()`). That gives grow columns a real
//     floor — fixed mode ignores cell-level min-width, but it does
//     respect `min-width` on the table itself. When the container is
//     wider than min-width the table tracks it; when narrower, the
//     table pins to min-width and the outer overflow-auto scrolls.
export function DataTable<TData>({
  table,
  actionBar,
  emptyMessage = "No results.",
  onRowClick,
  renderRow,
  footer,
  virtualizeRows = false,
  virtualRowHeight = 41,
  virtualOverscan = 10,
  reorderableColumnIds,
  onColumnReorder,
  reorderHandleLabel,
  gridLines = "full",
  rowClassName,
  scrollResetKey,
  className,
  ...props
}: DataTableProps<TData>) {
  const [resizingColumnId, setResizingColumnId] = React.useState<string | null>(
    null,
  );

  // Distance-based activation so a click on the grip (to reach it with a
  // screen reader, say) doesn't itself start a drag; keyboard activation
  // (Space/Enter) has no such threshold. Harmless to construct even when
  // onColumnReorder is unset — no DndContext ever mounts to consume them.
  const columnDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleColumnDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!onColumnReorder || !over || active.id === over.id) return;
      onColumnReorder(String(active.id), String(over.id));
    },
    [onColumnReorder],
  );

  const columnSizing = table.getState().columnSizing;
  const hasExplicitSize = React.useCallback(
    (columnId: string) =>
      Object.prototype.hasOwnProperty.call(columnSizing, columnId),
    [columnSizing],
  );

  const clampColumnWidth = React.useCallback(
    (columnId: string, width: number) => {
      const columnDef = table.getColumn(columnId)?.columnDef;
      const minSize = columnDef?.minSize ?? 48;
      const maxSize = columnDef?.maxSize ?? Number.MAX_SAFE_INTEGER;
      return Math.min(maxSize, Math.max(minSize, Math.round(width)));
    },
    [table],
  );

  const setColumnWidth = React.useCallback(
    (header: TanstackHeader<TData, unknown>, width: number) => {
      table.setColumnSizing((old) => ({
        ...old,
        [header.column.id]: clampColumnWidth(header.column.id, width),
      }));
    },
    [clampColumnWidth, table],
  );

  // Fixed table-layout shares out whatever space is left when the configured
  // widths add up to less than the table, so every column renders wider than
  // it is configured. Committing one column changes that leftover and rescales
  // all the others, which makes a drag run ahead of the pointer. Pinning every
  // column to the width it already renders at removes the leftover, so from
  // that point the drag maps 1:1 onto pointer movement.
  const freezeRenderedWidths = React.useCallback(
    (headerRow: Element | null): ColumnSizingState => {
      const frozen: ColumnSizingState = {};
      const cells =
        headerRow?.querySelectorAll<HTMLElement>("th[data-column-id]") ?? [];
      for (const cell of cells) {
        const columnId = cell.dataset.columnId;
        if (!columnId) continue;
        frozen[columnId] = clampColumnWidth(
          columnId,
          cell.getBoundingClientRect().width,
        );
      }
      return frozen;
    },
    [clampColumnWidth],
  );

  // Double-click on the resize handle sizes the column to its content, the
  // convention every spreadsheet and grid shares. It replaces column.resetSize,
  // which cleared the stored width and let TanStack fall back to its generic
  // 150 — a number unrelated to any of this table's designed widths, so
  // "reset" widened some columns and collapsed others.
  //
  // Fixed table-layout ignores content, and cells truncate their own text, so
  // nothing on screen reports the width the content actually wants. The
  // measurement lifts both constraints on the column's cells, reads them, and
  // puts everything back within the same task — the browser paints once, after
  // the restore, so the intermediate layout is never seen.
  const autoFitColumn = React.useCallback(
    (header: TanstackHeader<TData, unknown>) => {
      const container = scrollRef.current;
      const tableElement = container?.querySelector("table");
      if (!container || !tableElement) return;
      const cells = container.querySelectorAll<HTMLElement>(
        `[data-column-id="${CSS.escape(header.column.id)}"]`,
      );
      if (!cells.length) return;

      const previousLayout = tableElement.style.tableLayout;
      const previous = Array.from(cells, (cell) => ({
        cell,
        width: cell.style.width,
        maxWidth: cell.style.maxWidth,
        overflow: cell.style.overflow,
      }));

      tableElement.style.tableLayout = "auto";
      for (const cell of cells) {
        cell.style.width = "max-content";
        cell.style.maxWidth = "none";
        cell.style.overflow = "visible";
      }

      let widest = 0;
      for (const cell of cells) {
        widest = Math.max(widest, cell.getBoundingClientRect().width);
      }

      for (const entry of previous) {
        entry.cell.style.width = entry.width;
        entry.cell.style.maxWidth = entry.maxWidth;
        entry.cell.style.overflow = entry.overflow;
      }
      tableElement.style.tableLayout = previousLayout;

      if (widest > 0) setColumnWidth(header, widest);
    },
    [setColumnWidth],
  );

  const beginColumnResize = React.useCallback(
    (
      header: TanstackHeader<TData, unknown>,
      event: React.PointerEvent<HTMLDivElement>,
    ) => {
      if (!header.column.getCanResize()) return;

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const handleEl = event.currentTarget;
      const { pointerId } = event;
      const headerCell = handleEl.closest("th");
      // The rendered width, not column.getSize(): the drag has to continue from
      // the edge the user grabbed, which sits wherever the stretch put it.
      const startWidth =
        headerCell?.getBoundingClientRect().width ?? header.column.getSize();

      setResizingColumnId(header.column.id);

      let frozen: ColumnSizingState | null = null;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        const delta = pointerEvent.clientX - startX;
        // Nothing is committed below the threshold, so a press on its own can
        // no longer pin a column at the width the stretch happened to give it.
        if (!frozen && Math.abs(delta) < RESIZE_DRAG_THRESHOLD) return;
        // Measured once, on the frame the drag starts — every later frame
        // reuses it, so the baseline can't drift as widths change underneath.
        frozen ??= freezeRenderedWidths(handleEl.closest("tr"));

        table.setColumnSizing((old) => ({
          ...old,
          ...frozen,
          [header.column.id]: clampColumnWidth(
            header.column.id,
            startWidth + delta,
          ),
        }));
      };

      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        window.removeEventListener("blur", stopResize);
        // Detached before releasing capture — releasing fires this same event.
        handleEl.removeEventListener("lostpointercapture", stopResize);
        if (handleEl.hasPointerCapture?.(pointerId)) {
          handleEl.releasePointerCapture?.(pointerId);
        }
        setResizingColumnId(null);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      // Releasing outside the window or switching apps mid-drag never delivers
      // pointerup. Without these the gesture stays armed and the column keeps
      // tracking the pointer once the user comes back.
      window.addEventListener("blur", stopResize);
      handleEl.addEventListener("lostpointercapture", stopResize);
      // Optional call: jsdom has no pointer capture.
      handleEl.setPointerCapture?.(pointerId);
    },
    [clampColumnWidth, freezeRenderedWidths, table],
  );

  const handleResizeKeyDown = React.useCallback(
    (
      header: TanstackHeader<TData, unknown>,
      event: React.KeyboardEvent<HTMLDivElement>,
    ) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      event.stopPropagation();

      const headerCell = event.currentTarget.closest("th");
      const currentWidth = hasExplicitSize(header.column.id)
        ? header.column.getSize()
        : (headerCell?.getBoundingClientRect().width ??
          header.column.getSize());
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 20 : 8;

      setColumnWidth(header, currentWidth + direction * step);
    },
    [hasExplicitSize, setColumnWidth],
  );

  // Every column's width, published once on the <table>. Cells reference these
  // instead of each calling column.getSize(), so a resize costs one style
  // update on one element rather than one per cell.
  const leafColumns = table.getVisibleLeafColumns();
  const columnSizeVars = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const column of leafColumns) {
      vars[columnSizeVar(column.id)] = `${column.getSize()}px`;
    }
    return vars;
    // column.getSize() reads columnSizing, which the rule cannot see through
    // the call. getVisibleLeafColumns is memoised on visibility and order, so
    // without it the widths would freeze at whatever they were on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getSize() reads columnSizing
  }, [columnSizing, leafColumns]);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Only a change resets: the first render has nothing to reset, and a
  // re-render with the same key (a refetch, an edit, a load-more) keeps the
  // reader where they are. A layout effect, so the new result never paints
  // at the old offset.
  const lastScrollResetKey = React.useRef(scrollResetKey);
  React.useLayoutEffect(() => {
    if (lastScrollResetKey.current === scrollResetKey) return;
    lastScrollResetKey.current = scrollResetKey;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollResetKey]);

  // Drives the pinned columns' trailing shadow. It only means something once
  // content is passing beneath them, so it stays off at rest. The state is a
  // boolean rather than the offset: it flips twice per scroll excursion
  // instead of once per scroll event, and React bails out on the repeats.
  const [isScrolledHorizontally, setIsScrolledHorizontally] =
    React.useState(false);

  // Where the frozen block ends, in the scroll container's own coordinates.
  const [pinnedEdge, setPinnedEdge] = React.useState<number | null>(null);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const sync = () => {
      setIsScrolledHorizontally(element.scrollLeft > 0);
      const edge = element.querySelector("thead th[data-pinned-edge]");
      setPinnedEdge(
        edge
          ? edge.getBoundingClientRect().right -
              element.getBoundingClientRect().left
          : null,
      );
    };
    sync();
    element.addEventListener("scroll", sync, { passive: true });
    return () => element.removeEventListener("scroll", sync);
    // Re-measured on column sizing too, not scrolling alone: resizing a frozen
    // column while the surface is scrolled moves the boundary the shadow is
    // pinned to, and no scroll event follows to correct it.
  }, [columnSizing]);

  const rows = table.getRowModel().rows;
  const getVirtualRowKey = React.useCallback(
    (index: number) => rows[index]?.id ?? index,
    [rows],
  );
  const rowVirtualizer = useVirtualizer({
    count: virtualizeRows ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => virtualRowHeight,
    getItemKey: getVirtualRowKey,
    overscan: virtualOverscan,
    // Rows are not all one height. Callers use renderRow for group headers and
    // end-of-column footers, which are shorter than a data row, so a single
    // estimate drifts from the real layout as those accumulate — the window
    // lands off the rows it should be showing and the scrollbar overshoots the
    // bottom. Each mounted row reports its own height instead, and the
    // estimate only covers rows that have never been on screen.
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const firstVirtualItem = virtualItems[0];
  const lastVirtualItem = virtualItems[virtualItems.length - 1];
  const virtualPaddingTop = firstVirtualItem?.start ?? 0;
  const virtualPaddingBottom = lastVirtualItem
    ? rowVirtualizer.getTotalSize() - lastVirtualItem.end
    : 0;

  const bodyProps: DataTableBodyProps<TData> = {
    table,
    rows,
    emptyMessage,
    onRowClick,
    renderRow,
    hasExplicitSize,
    measureRow: rowVirtualizer.measureElement,
    virtualizeRows,
    virtualItems,
    virtualPaddingTop,
    virtualPaddingBottom,
    gridLines,
    rowClassName,
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      {...props}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-slot="data-table-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-auto bg-background"
      >
        {/* Wraps the whole <table>, not just the header row: DndContext
          * renders its own screen-reader-only live region as a sibling of
          * its children wherever it sits in the tree, and a <div> is not
          * valid inside a <table> — even one that never paints. */}
        <DataTableHeaderShell
          enabled={Boolean(onColumnReorder)}
          sensors={columnDragSensors}
          reorderableColumnIds={reorderableColumnIds ?? []}
          onDragEnd={handleColumnDragEnd}
        >
        <table
          className="w-full table-fixed caption-bottom text-body"
          style={{
            minWidth: `${table.getTotalSize()}px`,
            ...columnSizeVars,
          }}
        >
          {/* Opaque rather than translucent-and-blurred. A backdrop-filter on
            * a sticky element with content scrolling beneath it is a known
            * Chromium compositing fault (electron#12906, chromium#339841685) —
            * the blur layer has to recompute its backdrop every frame while
            * virtualisation adds and removes the rows underneath it, and the
            * strip flickers black. The mix resolves to the same colour
            * bg-muted/30 composited to, and a header that scrolled content
            * passes behind has no reason to show it through anyway. */}
            <TableHeader
              className={cn(
                "sticky top-0 z-10 bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]",
                gridLines === "horizontal" && "[&_tr]:border-border",
              )}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                  const isPinned = header.column.getIsPinned();
                  const columnHasExplicitSize = hasExplicitSize(
                    header.column.id,
                  );
                  const isPinnedEdge =
                    isPinned === "left" &&
                    header.column.getIsLastColumn("left");
                  const headerLabel =
                    typeof header.column.columnDef.header === "string"
                      ? header.column.columnDef.header
                      : header.column.id;

                  // Non-reorderable ids (row-select, the primary column, a
                  // trailing "add column" affordance, …) fall straight
                  // through to the branch below and render unchanged.
                  if (
                    onColumnReorder &&
                    reorderableColumnIds?.includes(header.column.id)
                  ) {
                    return (
                      <DataTableSortableHeadCell
                        key={header.id}
                        header={header}
                        headerLabel={headerLabel}
                        isPinned={isPinned}
                        columnHasExplicitSize={columnHasExplicitSize}
                        resizingColumnId={resizingColumnId}
                        reorderHandleLabel={reorderHandleLabel}
                        gridLines={gridLines}
                        beginColumnResize={beginColumnResize}
                        autoFitColumn={autoFitColumn}
                        handleResizeKeyDown={handleResizeKeyDown}
                      />
                    );
                  }

                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      // Lets a drag measure every column by id instead of
                      // pairing <th> elements with columns positionally.
                      data-column-id={header.column.id}
                      // Marks the frozen block's trailing edge for the scroll
                      // shadow to measure against. Rendered widths differ from
                      // configured ones under fixed table-layout, so the
                      // boundary has to be read off the DOM, not summed.
                      data-pinned-edge={isPinnedEdge ? "" : undefined}
                      // Header typography overrides for a "spreadsheet
                      // header" look: smaller, all-caps, wider letter
                      // spacing, muted colour. shadcn's <TableHead>
                      // defaults to text-body + text-foreground +
                      // font-medium, which reads as too heavy here.
                      // h-8 (32px) tightens the strip vs the default
                      // h-10 (40px).
                      // overflow-hidden caps any cell content that
                      // exceeds column.size. Tooltip / dropdown /
                      // hover-card bodies are portaled, so they are
                      // unaffected.
                      // Pinned cells must be opaque: translucent backgrounds
                      // reveal horizontally scrolled columns underneath. Mix
                      // muted with background to preserve the same visual tone
                      // as muted/30 without introducing alpha.
                      className={cn(
                        "relative h-8 overflow-hidden px-4 py-2 text-caption uppercase tracking-wider text-muted-foreground pointer-coarse:h-11",
                        cellRuleClass(gridLines, isPinnedEdge),
                        isPinned &&
                          "bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]",
                      )}
                      style={getCellStyle(header.column, {
                        hasExplicitSize: columnHasExplicitSize,
                      })}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      {!header.isPlaceholder &&
                        header.column.getCanResize() && (
                          // A focusable separator is the ARIA window-splitter
                          // pattern; jsx-a11y files separator as non-interactive
                          // and cannot see the resize handlers.
                          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                          <div
                            role="separator"
                            aria-label={`Resize ${headerLabel} column`}
                            aria-orientation="vertical"
                            /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */
                            tabIndex={0}
                            className={cn(
                              // The line sits exactly on the column's own
                              // border (hence -right-px, since `right-0` would
                              // land just inside it and read as a double rule)
                              // and recolours it. Three states have to stay
                              // apart on one hairline: at rest it is the faint
                              // grid rule, hovered it goes translucent brand,
                              // and for the whole drag it holds at full brand —
                              // brightening rather than fading, so the edge
                              // being moved stays the most definite thing on
                              // screen even once the pointer leaves the handle.
                              // right-0, never a negative offset: the <th> is
                              // overflow-hidden and clips at its padding edge,
                              // so anything nudged out to sit on the border
                              // itself is simply not painted. The bar lands
                              // just inside the rule instead, and at 2px it
                              // stays legible next to it.
                              "absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none outline-none",
                              "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent after:transition-colors after:duration-100",
                              "hover:after:bg-brand/60 focus-visible:after:bg-brand/60",
                              resizingColumnId === header.column.id &&
                                "after:bg-brand after:transition-none",
                            )}
                            onPointerDown={(event) =>
                              beginColumnResize(header, event)
                            }
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              autoFitColumn(header);
                            }}
                            onKeyDown={(event) =>
                              handleResizeKeyDown(header, event)
                            }
                          />
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          {/* Widths reach the body through the custom properties above, so
            * while a column is being dragged the body has nothing to re-render:
            * swap in the memoized copy and let the browser do the resizing. */}
          {resizingColumnId !== null ? (
            <MemoizedDataTableBody {...bodyProps} />
          ) : (
            <DataTableBody {...bodyProps} />
          )}
          {footer}
        </table>
        </DataTableHeaderShell>
      </div>
      {/* Cast past the frozen block rather than drawn inside it. The border
        * between the frozen columns and the rest is permanent and says where
        * the boundary is; this says something is currently passing underneath,
        * so it appears only while scrolled. An inset box-shadow on the pinned
        * cell could only darken that cell's own edge — the depth belongs on
        * the content sliding beneath it. */}
      {isScrolledHorizontally && pinnedEdge !== null && (
        <div
          aria-hidden
          data-slot="data-table-pinned-shadow"
          className="pointer-events-none absolute inset-y-0 w-3"
          style={{
            left: `${pinnedEdge}px`,
            background:
              "linear-gradient(to right, color-mix(in oklab, var(--foreground) 7%, transparent), transparent)",
          }}
        />
      )}
      </div>
      {/* A viewport-wide layer that only exists for the duration of a column
        * drag. It owns the cursor so descendants that declare their own
        * (rows are `cursor-pointer`, cells hold text) cannot override it, and
        * it keeps the text underneath unselectable. Setting these on
        * document.body instead loses both fights, since a descendant's own
        * cursor wins over an inherited one. Pointer events still reach the
        * gesture: it listens on `window`, which the layer's events bubble to.
        * Portaled to body so an ancestor with a transform / filter / contain
        * cannot turn `fixed` into "relative to that ancestor". */}
      {resizingColumnId !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden
            data-slot="data-table-resize-overlay"
            className="fixed inset-0 z-50 cursor-col-resize touch-none select-none"
          />,
          document.body,
        )}
      {actionBar &&
        table.getFilteredSelectedRowModel().rows.length > 0 &&
        actionBar}
    </div>
  );
}

// Mounts DndContext/SortableContext around the header row only when a caller
// opted into reordering. Kept as its own component (rather than an inline
// ternary around <TableHeader>) so the sensors and context genuinely don't
// exist — not just go unused — for every table that never passes
// onColumnReorder, matching the "render exactly as today" contract.
//
// `enabled` is read from `Boolean(onColumnReorder)`: toggling that prop
// between defined and undefined flips this branch and remounts the whole
// <table> subtree underneath it (DndContext unmounts/mounts), so callers
// should treat `onColumnReorder` as stable across renders, not conditionally
// passed. Also untested here: this wraps the table body too (see the call
// site), so if a caller ever adds its own row-level dnd-kit (row drag/reorder)
// inside the same DataTable, its interaction with this column-drag context
// has no coverage.
function DataTableHeaderShell({
  enabled,
  sensors,
  reorderableColumnIds,
  onDragEnd,
  children,
}: {
  enabled: boolean;
  sensors: ReturnType<typeof useSensors>;
  reorderableColumnIds: string[];
  onDragEnd: (event: DragEndEvent) => void;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={reorderableColumnIds}
        strategy={horizontalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

// A reorderable header cell. Split out from the inline header render so only
// columns actually listed in `reorderableColumnIds` call useSortable — every
// other header, including every header in a table with no onColumnReorder,
// never touches dnd-kit at all.
function DataTableSortableHeadCell<TData>({
  header,
  headerLabel,
  isPinned,
  columnHasExplicitSize,
  resizingColumnId,
  reorderHandleLabel,
  gridLines,
  beginColumnResize,
  autoFitColumn,
  handleResizeKeyDown,
}: {
  header: TanstackHeader<TData, unknown>;
  headerLabel: string;
  isPinned: false | "left" | "right";
  columnHasExplicitSize: boolean;
  resizingColumnId: string | null;
  reorderHandleLabel?: (columnId: string) => string;
  gridLines: DataTableGridLines;
  beginColumnResize: (
    header: TanstackHeader<TData, unknown>,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  autoFitColumn: (header: TanstackHeader<TData, unknown>) => void;
  handleResizeKeyDown: (
    header: TanstackHeader<TData, unknown>,
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: header.column.id });
  const isPinnedEdge =
    isPinned === "left" && header.column.getIsLastColumn("left");
  const gripLabel = reorderHandleLabel
    ? reorderHandleLabel(header.column.id)
    : `Reorder ${headerLabel} column`;

  return (
    <TableHead
      ref={setNodeRef}
      colSpan={header.colSpan}
      data-column-id={header.column.id}
      data-pinned-edge={isPinnedEdge ? "" : undefined}
      className={cn(
        "group/reorder relative h-8 overflow-hidden px-4 py-2 text-caption uppercase tracking-wider text-muted-foreground pointer-coarse:h-11",
        cellRuleClass(gridLines, isPinnedEdge),
        isPinned &&
          "bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]",
        isDragging && "z-20 bg-accent",
      )}
      style={{
        ...getCellStyle(header.column, { hasExplicitSize: columnHasExplicitSize }),
        // horizontalListSortingStrategy already zeroes the y component; the
        // DndContext-level modifier covers the pointer overlay this
        // per-item transform doesn't reach.
        transform: DndCSS.Translate.toString(transform),
        transition,
      }}
    >
      {/* Hidden at rest so it doesn't compete with the label; a real button
        * (not the whole header) so pointer/keyboard drag activation stays
        * scoped to an explicit, discoverable control. No outline-none: the
        * global :focus-visible outline stays the focus indicator, per the
        * primitive contract in CLAUDE.md.
        *
        * The visible button is 16px (w-4) — too small a touch target on its
        * own. `after:` adds an invisible hit area, coarse pointers only, that
        * grows it to the full 44px (w-11) without changing anything
        * paintable; `pointer-coarse:h-11` on the <TableHead> above (both this
        * branch and the plain one) grows the header row to 44px on the same
        * pointers so the hit area covers the full cell height, not just the
        * 32px (h-8) fine-pointer row.
        *
        * A 44px-wide area at this cell's left edge can still reach into the
        * resize handle's 8px hit area, flush at the cell's right edge, on a
        * narrow enough column. The task table's reorderable columns are all
        * ≥80px (`dataCols` in table-view-columns.tsx), which leaves a 28px
        * gap — safe. A generic caller of this primitive with narrower
        * reorderable + resizable columns (< ~52px) could see the two hit
        * areas overlap; that's a caller-configuration concern, not something
        * fixed-width geometry here can rule out for every possible column
        * width. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={gripLabel}
        data-slot="data-table-reorder-handle"
        className={cn(
          "absolute inset-y-0 left-0 z-10 flex w-4 cursor-grab items-center justify-center opacity-0 transition-opacity",
          "after:absolute after:inset-y-0 after:left-0 after:w-4 pointer-coarse:after:w-11",
          "hover:text-foreground focus-visible:opacity-100 group-hover/reorder:opacity-100 group-focus-within/reorder:opacity-100",
          isDragging && "cursor-grabbing opacity-100 text-foreground",
        )}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <span className="block truncate pl-4">
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
      </span>
      {!header.isPlaceholder && header.column.getCanResize() && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="separator"
          aria-label={`Resize ${headerLabel} column`}
          aria-orientation="vertical"
          /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */
          tabIndex={0}
          className={cn(
            "absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none outline-none",
            "after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent after:transition-colors after:duration-100",
            "hover:after:bg-brand/60 focus-visible:after:bg-brand/60",
            resizingColumnId === header.column.id &&
              "after:bg-brand after:transition-none",
          )}
          onPointerDown={(event) => beginColumnResize(header, event)}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            autoFitColumn(header);
          }}
          onKeyDown={(event) => handleResizeKeyDown(header, event)}
        />
      )}
    </TableHead>
  );
}

interface DataTableBodyProps<TData> {
  table: TanstackTable<TData>;
  rows: Row<TData>[];
  emptyMessage: React.ReactNode;
  onRowClick?: (row: Row<TData>, event: React.MouseEvent) => void;
  renderRow?: (row: Row<TData>) => React.ReactNode;
  hasExplicitSize: (columnId: string) => boolean;
  // The virtualizer's own measuring ref; rows report their height through it.
  measureRow: (element: HTMLElement | null) => void;
  virtualizeRows: boolean;
  virtualItems: VirtualItem[];
  virtualPaddingTop: number;
  virtualPaddingBottom: number;
  gridLines: DataTableGridLines;
  rowClassName?: string;
}

function DataTableBody<TData>({
  table,
  rows,
  emptyMessage,
  onRowClick,
  renderRow,
  hasExplicitSize,
  measureRow,
  virtualizeRows,
  virtualItems,
  virtualPaddingTop,
  virtualPaddingBottom,
  gridLines,
  rowClassName,
}: DataTableBodyProps<TData>) {
  const renderDataRow = (row: Row<TData>, index?: number) => {
    // The virtualizer reads an element's own height off `data-index`, so a row
    // has to be tagged and handed the measuring ref. renderRow returns a <tr>
    // the caller built; cloning is how it joins in without every caller having
    // to thread the two through.
    const measured =
      index === undefined
        ? {}
        : { "data-index": index, ref: measureRow };

    const customRow = renderRow?.(row);
    if (customRow != null) {
      return React.isValidElement(customRow) && index !== undefined
        ? React.cloneElement(
            customRow as React.ReactElement<Record<string, unknown>>,
            { key: row.id, ...measured },
          )
        : <React.Fragment key={row.id}>{customRow}</React.Fragment>;
    }
    return (
      <TableRow
        key={row.id}
        {...measured}
        data-state={row.getIsSelected() && "selected"}
        onClick={
          onRowClick
            ? (e) => {
                if (e.defaultPrevented) return;
                onRowClick(row, e);
              }
            : undefined
        }
        // Middle click never produces a `click` event; forward it through the
        // same callback (button === 1 only — button 2 is the context menu).
        onAuxClick={
          onRowClick
            ? (e) => {
                if (e.defaultPrevented || e.button !== 1) return;
                e.preventDefault();
                onRowClick(row, e);
              }
            : undefined
        }
        // `group` lets pinned cells track row hover via group-hover (their bg
        // is in className, not on the row, so they stay opaque enough to cover
        // content scrolling beneath them).
        className={cn("group", onRowClick && "cursor-pointer", rowClassName)}
      >
        {row.getVisibleCells().map((cell) => {
          const isPinned = cell.column.getIsPinned();
          const isPinnedEdge =
            isPinned === "left" && cell.column.getIsLastColumn("left");
          const columnHasExplicitSize = hasExplicitSize(cell.column.id);
          return (
            <TableCell
              key={cell.id}
              data-column-id={cell.column.id}
              // px-4 across the board so cell content aligns with the
              // surrounding toolbar's px-4. Narrow trailing columns
              // (chevron / actions) declare enough width for icon + padding.
              // Pinned cells need an opaque bg + group-hover so they cover
              // content scrolling beneath them and follow row hover state.
              className={cn(
                "overflow-hidden px-4 py-2",
                cellRuleClass(gridLines, isPinnedEdge),
                isPinned &&
                  "bg-background group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]",
              )}
              style={getCellStyle(cell.column, {
                hasExplicitSize: columnHasExplicitSize,
              })}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  const renderVirtualSpacer = (position: "top" | "bottom", height: number) =>
    height > 0 ? (
      <TableRow
        key={`virtual-spacer-${position}`}
        aria-hidden
        className="pointer-events-none border-0 hover:bg-transparent"
      >
        <TableCell
          colSpan={table.getVisibleLeafColumns().length}
          className="p-0"
          style={{ height: `${height}px` }}
        />
      </TableRow>
    ) : null;

  return (
    <TableBody
      className={cn(gridLines === "horizontal" && "[&>tr]:border-border/60")}
    >
      {rows.length ? (
        virtualizeRows ? (
          <>
            {renderVirtualSpacer("top", virtualPaddingTop)}
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index];
              return row ? renderDataRow(row, virtualItem.index) : null;
            })}
            {renderVirtualSpacer("bottom", virtualPaddingBottom)}
          </>
        ) : (
          rows.map(renderDataRow)
        )
      ) : (
        <TableRow>
          <TableCell
            colSpan={table.getAllColumns().length}
            className="h-24 text-center text-muted-foreground"
          >
            {emptyMessage}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

// Rendered in place of DataTableBody for the duration of a column drag. Only
// the row data is compared: during a drag the widths travel as custom
// properties and nothing else in the body can change, so skipping the render
// entirely is what keeps hundreds of cells off the main thread per frame.
// React.memo erases the generic, so the cast restores the original signature.
const MemoizedDataTableBody = React.memo(
  DataTableBody,
  (prev, next) => prev.table.options.data === next.table.options.data,
) as typeof DataTableBody;
