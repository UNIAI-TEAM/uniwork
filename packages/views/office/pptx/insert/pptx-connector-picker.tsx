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
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
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
  onInsertConnector,
  onGroupSelection,
  className,
}: PptxConnectorPickerProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<PptxConnectorKind>("straight");
  const [arrow, setArrow] = useState<PptxConnectorArrow>("end");
  const [from, setFrom] = useState<string>(selectedIds[0] ?? "");
  const [to, setTo] = useState<string>(selectedIds[1] ?? "");

  const connectable = useMemo(
    () => elements.filter((element) => element.type === "text" || element.type === "shape" || element.type === "picture"),
    [elements],
  );
  const options = useMemo(
    () => connectable.map((element) => ({ value: element.id, label: element.label ?? element.id })),
    [connectable],
  );
  const groupIds = useMemo(() => groupableSelection(selectedIds, elements), [elements, selectedIds]);
  const connectorBlocked = connectorDisabled || busy;
  const groupBlocked = groupDisabled || busy;
  const request: PptxInsertConnectorRequest = { slideIndex: 0, from, to, kind, arrow };
  const validation = validateConnectorRequest({ ...request, slideIndex: 0 }, elements);
  const canConnect = !connectorBlocked && validation.ok && connectable.length >= 2;
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
          id="pptx-connector-from"
          items={options}
          value={from}
          disabled={connectorBlocked}
          onValueChange={(value) => setFrom(String(value))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pptx-connector-to">{t("office.pptx.insert.connector.to_label")}</Label>
        <Select
          id="pptx-connector-to"
          items={options}
          value={to}
          disabled={connectorBlocked}
          onValueChange={(value) => setTo(String(value))}
        />
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