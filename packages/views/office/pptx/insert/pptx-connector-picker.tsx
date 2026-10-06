"use client";

/**
 * A3ui (UNI-927) - Insert > Connectors, and Group selection.
 *
 * The connector picker chooses two top-level elements and a connector kind, and
 * validates the pair with the pure `validateConnectorRequest` before it emits
 * anything: the vendored `addConnector` refuses `from === to` and non-connectable
 * types, so the button says why instead of sending a doomed request.
 *
 * The request leaves through `onInsertConnector`; the engine half that binds
 * `addConnector` is A4e's (arrange), so this panel owns only the request shape.
 * `Group selection` rides the `group_elements` edit with the same
 * connectable-type filter (`groupableSelection`); `group_elements` is a
 * `FormatEdit` member the wire round registers (not yet in the `PptxEdit`
 * union), which is why it travels its own channel.
 */
import { useMemo, useState } from "react";
import { Link2, Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { formatColorInputValue, formatDashKey, type PptxFormatDash } from "../format/format-model";
import { PPTX_CONNECTOR_DEFAULT_LINE } from "./insert-defaults";
import {
  PPTX_CONNECTOR_DASHES,
  PPTX_CONNECTOR_SIDE_CHOICES,
  connectorLineOf,
  connectorRequestLine,
  connectorSideOf,
  type PptxConnectorLineChoice,
  type PptxConnectorSideChoice,
} from "./connector-model";
import {
  PPTX_CONNECTOR_ARROWS,
  PPTX_CONNECTOR_KINDS,
  groupableSelection,
  validateConnectorRequest,
  type PptxConnectorArrow,
  type PptxConnectorKind,
  type PptxInsertConnectorRequest,
  type PptxInsertElementRef,
} from "./insert-model";

export interface PptxConnectorPickerProps {
  /** Top-level elements of the current slide (the picker's only source). */
  elements: readonly PptxInsertElementRef[];
  /** Element ids currently selected on the canvas; seeds the two pickers. */
  selectedIds?: readonly string[];
  /** No connector channel bound / no slide: the connector controls are inert. */
  connectorDisabled?: boolean;
  /** No grouping channel bound / no slide: only the Group button is inert. */
  groupDisabled?: boolean;
  busy?: boolean;
  /** Restyle the selected connector (set_stroke); absent disables Apply. */
  onStrokeConnector?: (elementId: string, line: PptxConnectorLineChoice) => void;
  onInsertConnector: (request: PptxInsertConnectorRequest) => void;
  onGroupSelection: (elementIds: readonly string[]) => void;
  className?: string;
}

export function PptxConnectorPicker({
  elements,
  selectedIds = [],
  connectorDisabled = false,
  groupDisabled = false,
  busy = false,
  onStrokeConnector,
  onInsertConnector,
  onGroupSelection,
  className,
}: PptxConnectorPickerProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<PptxConnectorKind>("straight");
  const [arrow, setArrow] = useState<PptxConnectorArrow>("end");
  const connectable = useMemo(
    () => elements.filter((element) => !element.connector && (element.type === "text" || element.type === "shape" || element.type === "picture")),
    [elements],
  );
  // Seed from the canvas selection, but only with a shape the pickers can name:
  // a value without an item makes the select print the raw id.
  const seed = (id: string | undefined): string => (id !== undefined && connectable.some((element) => element.id === id) ? id : "");
  const [fromSide, setFromSide] = useState<PptxConnectorSideChoice>("auto");
  const [toSide, setToSide] = useState<PptxConnectorSideChoice>("auto");
  const [line, setLine] = useState<PptxConnectorLineChoice>(() => ({ ...PPTX_CONNECTOR_DEFAULT_LINE, widthPt: String(PPTX_CONNECTOR_DEFAULT_LINE.widthPt) }));
  const [from, setFrom] = useState<string>(() => seed(selectedIds[0]));
  const [to, setTo] = useState<string>(() => seed(selectedIds[1]));
  // An unlabeled shape reads "Shape N" by its position, never by its id.
  const options = useMemo(
    () => connectable.map((element, index) => ({ value: element.id, label: element.label ?? t("office.pptx.insert.connector.shape_n", { n: index + 1 }) })),
    [connectable, t],
  );
  const sideItems = useMemo(() => PPTX_CONNECTOR_SIDE_CHOICES.map((value) => ({ value, label: t(`office.pptx.insert.connector.side.${value}`) })), [t]);
  const dashItems = useMemo(() => PPTX_CONNECTOR_DASHES.map((value) => ({ value, label: t(formatDashKey(value)) })), [t]);
  const lineValid = connectorLineOf(line) !== null;
  const selectedConnector = selectedIds.length === 1 ? elements.find((element) => element.id === selectedIds[0] && element.connector) : undefined;
  const pickerChildren = (id: string) => (
    <>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={t("office.pptx.insert.connector.pick_shape")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </>
  );
  const groupIds = useMemo(() => groupableSelection(selectedIds, elements), [elements, selectedIds]);
  const connectorBlocked = connectorDisabled || busy;
  const groupBlocked = groupDisabled || busy;
  const lineRequest = connectorRequestLine(line);
  const sideFrom = connectorSideOf(fromSide);
  const sideTo = connectorSideOf(toSide);
  const request: PptxInsertConnectorRequest = {
    slideIndex: 0,
    from,
    to,
    kind,
    arrow,
    ...(sideFrom ? { fromSide: sideFrom } : {}),
    ...(sideTo ? { toSide: sideTo } : {}),
    ...(lineRequest ? { line: lineRequest } : {}),
  };
  const validation = validateConnectorRequest({ ...request, slideIndex: 0 }, elements);
  const canConnect = !connectorBlocked && validation.ok && lineValid && connectable.length >= 2;
  const reason = validation.ok ? null : t(validation.reasonKey);

  return (
    <div className={cn("space-y-3", className)} data-pptx-insert-connector>
      <div className="space-y-1.5">
        <p className="text-label font-medium text-foreground">{t("office.pptx.insert.connector.title")}</p>
        <p className="text-caption text-muted-foreground">{t("office.pptx.insert.connector.hint")}</p>
      </div>

      {connectable.length < 2 ? (
        <p className="text-caption text-muted-foreground" data-pptx-connector-empty data-testid="pptx-connector-empty">
          {t("office.pptx.insert.connector.empty")}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <p id="pptx-connector-kind-label" className="text-caption font-medium text-foreground">
          {t("office.pptx.insert.connector.kind_label")}
        </p>
        <ToggleGroup
          value={[kind]}
          aria-labelledby="pptx-connector-kind-label"
          disabled={connectorBlocked}
          className="rounded-lg bg-muted p-1"
          onValueChange={(value) => {
            const next = value[0] as PptxConnectorKind | undefined;
            if (next) setKind(next);
          }}
        >
          {PPTX_CONNECTOR_KINDS.map((candidate) => (
            <ToggleGroupItem key={candidate} value={candidate} data-pptx-connector-kind={candidate}>
              {t(`office.pptx.insert.connector.kind.${candidate}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pptx-connector-from">{t("office.pptx.insert.connector.from_label")}</Label>
        <Select
          items={options}
          value={from || null}
          disabled={connectorBlocked}
          onValueChange={(value) => setFrom(String(value))}
        >
          {pickerChildren("pptx-connector-from")}
        </Select>
        <SideSelect id="pptx-connector-from-side" label={t("office.pptx.insert.connector.from_side_label")} value={fromSide} items={sideItems} disabled={connectorBlocked} onChange={setFromSide} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pptx-connector-to">{t("office.pptx.insert.connector.to_label")}</Label>
        <Select
          items={options}
          value={to || null}
          disabled={connectorBlocked}
          onValueChange={(value) => setTo(String(value))}
        >
          {pickerChildren("pptx-connector-to")}
        </Select>
        <SideSelect id="pptx-connector-to-side" label={t("office.pptx.insert.connector.to_side_label")} value={toSide} items={sideItems} disabled={connectorBlocked} onChange={setToSide} />
      </div>

      <div className="space-y-1.5">
        <p id="pptx-connector-arrow-label" className="text-caption font-medium text-foreground">
          {t("office.pptx.insert.connector.arrow_label")}
        </p>
        <ToggleGroup
          value={[arrow]}
          aria-labelledby="pptx-connector-arrow-label"
          disabled={connectorBlocked}
          className="rounded-lg bg-muted p-1"
          onValueChange={(value) => {
            const next = value[0] as PptxConnectorArrow | undefined;
            if (next) setArrow(next);
          }}
        >
          {PPTX_CONNECTOR_ARROWS.map((candidate) => (
            <ToggleGroupItem key={candidate} value={candidate} data-pptx-connector-arrow={candidate}>
              {t(`office.pptx.insert.connector.arrow.${candidate}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-1.5" data-pptx-connector-line>
        <p className="text-caption font-medium text-foreground">{t("office.pptx.format.line_label")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t("office.pptx.format.line_color")}
            data-testid="pptx-connector-line-color"
            value={formatColorInputValue(line.color, "#000000")}
            disabled={connectorBlocked}
            onChange={(event) => setLine((current) => ({ ...current, color: event.target.value }))}
            className="size-8 rounded-md border border-border bg-background"
          />
          <Input
            aria-label={t("office.pptx.format.line_width")}
            data-testid="pptx-connector-line-width"
            inputMode="decimal"
            value={line.widthPt}
            disabled={connectorBlocked}
            aria-invalid={connectorLineOf(line) === null ? true : undefined}
            onChange={(event) => setLine((current) => ({ ...current, widthPt: event.target.value }))}
            className="w-20"
          />
          <Select
            value={line.dash}
            items={dashItems}
            disabled={connectorBlocked}
            onValueChange={(value) => setLine((current) => ({ ...current, dash: value as PptxFormatDash }))}
          >
            <SelectTrigger aria-label={t("office.pptx.format.line_dash")} data-testid="pptx-connector-line-dash" size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dashItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={connectorBlocked || !lineValid || !selectedConnector || !onStrokeConnector}
          data-testid="pptx-connector-apply-line"
          onClick={() => selectedConnector && onStrokeConnector?.(selectedConnector.id, line)}
        >
          <span className="text-label">{t("office.pptx.insert.connector.apply_line")}</span>
        </Button>
        {!selectedConnector ? <p className="text-caption text-muted-foreground">{t("office.pptx.insert.connector.apply_line_hint")}</p> : null}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!canConnect}
        data-pptx-connector-insert
        data-testid="pptx-connector-insert"
        onClick={() => onInsertConnector(request)}
      >
        <Link2 aria-hidden="true" />
        <span className="text-label">{t("office.pptx.insert.connector.insert")}</span>
      </Button>
      {reason && connectable.length >= 2 ? (
        <p className="text-caption text-muted-foreground" data-pptx-connector-reason data-testid="pptx-connector-reason">
          {reason}
        </p>
      ) : null}

      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-label font-medium text-foreground">{t("office.pptx.insert.group.title")}</p>
        <p className="text-caption text-muted-foreground">{t("office.pptx.insert.group.hint")}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={groupBlocked || groupIds.length < 2}
          data-pptx-group-selection
          data-testid="pptx-group-selection"
          onClick={() => onGroupSelection(groupIds)}
        >
          <Shapes aria-hidden="true" />
          <span className="text-label">{t("office.pptx.insert.group.apply")}</span>
        </Button>
        {groupIds.length < 2 ? (
          <p className="text-caption text-muted-foreground" data-pptx-group-hint data-testid="pptx-group-hint">
            {t("office.pptx.insert.group.need_two")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
function SideSelect({ id, label, value, items, disabled, onChange }: {
  id: string;
  label: string;
  value: PptxConnectorSideChoice;
  items: ReadonlyArray<{ value: PptxConnectorSideChoice; label: string }>;
  disabled: boolean;
  onChange: (value: PptxConnectorSideChoice) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-pptx-connector-side={id}>
      <Label htmlFor={id} className="shrink-0 text-caption text-muted-foreground">{label}</Label>
      <Select items={items} value={value} disabled={disabled} onValueChange={(next) => onChange(next as PptxConnectorSideChoice)}>
        <SelectTrigger id={id} size="sm" className="w-full" data-testid={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
