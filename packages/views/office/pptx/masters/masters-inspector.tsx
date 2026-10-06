"use client";

/**
 * Compact inspector for the selected master/layout element (B6ui): text, box,
 * fill, outline and delete. Every action builds one `MasterPanelEdit` and hands
 * it to `onEdit`; nothing here mutates a document. The parent remounts it (via
 * `key`) when the element or its box changes, so the drafts always seed from
 * the current element.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  MASTER_STROKE_WIDTH_MAX,
  boxToDraft,
  buildDeleteEdit,
  buildFillEdit,
  buildStrokeEdit,
  buildTextEdit,
  buildTransformEdit,
  colorInputValue,
  isTextElement,
  normalizeMasterColor,
  parseBoxDraft,
  parseStrokeWidth,
  type MasterBoxDraft,
  type MasterElementView,
  type MasterPanelEdit,
} from "./masters-model";

interface MastersInspectorProps {
  part: string;
  element: MasterElementView;
  disabled: boolean;
  onEdit: (edit: MasterPanelEdit) => void;
}

interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function ColorField({ id, label, value, disabled, onChange }: ColorFieldProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const valid = normalizeMasterColor(value) !== null;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={colorInputValue(value, "#000000")}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="size-8 rounded-md border border-border bg-background"
        />
        <Input
          id={id}
          aria-label={t("masters.color_hex")}
          value={value}
          disabled={disabled}
          aria-invalid={valid ? undefined : true}
          onChange={(event) => onChange(event.target.value)}
          className="w-28"
        />
      </div>
      {valid ? null : <span className="text-caption text-destructive">{t("masters.color_invalid")}</span>}
    </div>
  );
}

const BOX_FIELDS = ["x", "y", "w", "h"] as const;

export function MastersInspector({ part, element, disabled, onEdit }: MastersInspectorProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [text, setText] = useState(element.text ?? "");
  const [box, setBox] = useState<MasterBoxDraft>(() => boxToDraft(element.box));
  const [boxError, setBoxError] = useState(false);
  const [fill, setFill] = useState(element.fill ?? "#4472C4");
  const [stroke, setStroke] = useState("#000000");
  const [width, setWidth] = useState("");
  const [widthError, setWidthError] = useState(false);

  const id = element.id;
  const applyBox = () => {
    const parsed = parseBoxDraft(box);
    setBoxError(!parsed.ok);
    if (parsed.ok) onEdit(buildTransformEdit(part, id, parsed.box));
  };
  const applyFill = () => {
    const color = normalizeMasterColor(fill);
    if (color) onEdit(buildFillEdit(part, id, color));
  };
  const applyStroke = (clear: boolean) => {
    if (clear) {
      setWidthError(false);
      onEdit(buildStrokeEdit(part, id, null));
      return;
    }
    const color = normalizeMasterColor(stroke);
    const widthPt = parseStrokeWidth(width);
    setWidthError(widthPt === null);
    if (color && widthPt !== null) onEdit(buildStrokeEdit(part, id, color, widthPt));
  };

  return (
    <section
      aria-label={t("masters.inspector_label")}
      data-testid="pptx-masters-inspector"
      className="flex flex-col gap-3 rounded-md border border-border p-2"
    >
      {isTextElement(element) ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pptx-masters-text" className="text-caption font-medium text-muted-foreground">
            {t("masters.text_label")}
          </Label>
          <Input
            id="pptx-masters-text"
            value={text}
            placeholder={t("masters.text_placeholder")}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-pptx-masters-text-apply
            onClick={() => onEdit(buildTextEdit(part, id, text))}
            className="self-start"
          >
            {t("masters.text_apply")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-muted-foreground">{t("masters.position_label")}</span>
        <div className="grid grid-cols-4 gap-1.5">
          {BOX_FIELDS.map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <Label htmlFor={"pptx-masters-box-" + field} className="text-caption text-muted-foreground">
                {t("masters." + field)}
              </Label>
              <Input
                id={"pptx-masters-box-" + field}
                type="number"
                step="any"
                value={box[field]}
                disabled={disabled}
                aria-invalid={boxError ? true : undefined}
                onChange={(event) => setBox((prev) => ({ ...prev, [field]: event.target.value }))}
              />
            </div>
          ))}
        </div>
        {boxError ? (
          <span role="alert" className="text-caption text-destructive">
            {t("masters.box_invalid")}
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          data-pptx-masters-box-apply
          onClick={applyBox}
          className="self-start"
        >
          {t("masters.box_apply")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <ColorField
          id="pptx-masters-fill"
          label={t("masters.fill_label")}
          value={fill}
          disabled={disabled}
          onChange={setFill}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || normalizeMasterColor(fill) === null}
            data-pptx-masters-fill-apply
            onClick={applyFill}
          >
            {t("masters.fill_apply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-pptx-masters-fill-clear
            onClick={() => onEdit(buildFillEdit(part, id, null))}
          >
            {t("masters.fill_clear")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <ColorField
          id="pptx-masters-stroke"
          label={t("masters.stroke_label")}
          value={stroke}
          disabled={disabled}
          onChange={setStroke}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="pptx-masters-stroke-width" className="text-caption text-muted-foreground">
            {t("masters.stroke_width")}
          </Label>
          <Input
            id="pptx-masters-stroke-width"
            type="number"
            step="any"
            min={0}
            value={width}
            disabled={disabled}
            aria-invalid={widthError ? true : undefined}
            onChange={(event) => setWidth(event.target.value)}
            className="w-28"
          />
          {widthError ? (
            <span role="alert" className="text-caption text-destructive">
              {t("masters.stroke_width_invalid", { max: MASTER_STROKE_WIDTH_MAX })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || normalizeMasterColor(stroke) === null}
            data-pptx-masters-stroke-apply
            onClick={() => applyStroke(false)}
          >
            {t("masters.stroke_apply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-pptx-masters-stroke-clear
            onClick={() => applyStroke(true)}
          >
            {t("masters.stroke_clear")}
          </Button>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={disabled}
        data-pptx-masters-delete
        onClick={() => onEdit(buildDeleteEdit(part, id))}
        className="self-start"
      >
        {t("masters.delete")}
      </Button>
    </section>
  );
}
