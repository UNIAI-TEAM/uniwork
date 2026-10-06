"use client";

/**
 * Placeholder text style of the slide master view (UNI-939 T01): size, bold,
 * italic, colour and font of a placeholder's first level. On a master the
 * title/body slots restyle the master text styles every layout and slide
 * inherits; elsewhere the placeholder's own list style. Blank fields are left
 * as they are; Apply emits one `master_set_text_style` edit.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { normalizeMasterColor, parseFontSize, type MasterPanelEdit, type MasterTextStyleDraft } from "./masters-model";

interface MastersTextStyleProps {
  part: string;
  placeholder: string;
  /** The slot index of the selected placeholder; absent on a title. */
  idx?: number;
  disabled: boolean;
  onEdit: (edit: MasterPanelEdit) => void;
}

export function MastersTextStyle({ part, placeholder, idx, disabled, onEdit }: MastersTextStyleProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const id = useId();
  const [size, setSize] = useState("");
  const [bold, setBold] = useState<boolean | undefined>(undefined);
  const [italic, setItalic] = useState<boolean | undefined>(undefined);
  const [color, setColor] = useState("");
  const [font, setFont] = useState("");

  const sizePt = parseFontSize(size);
  const hex = color.trim() === "" ? undefined : normalizeMasterColor(color);
  const draft: MasterTextStyleDraft = {
    ...(typeof sizePt === "number" ? { sizePt } : {}),
    ...(bold !== undefined ? { bold } : {}),
    ...(italic !== undefined ? { italic } : {}),
    ...(hex ? { color: hex } : {}),
    ...(font.trim() ? { font: font.trim() } : {}),
  };
  const invalid = sizePt === null || hex === null;
  const empty = Object.keys(draft).length === 0;

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-2"
      data-pptx-masters-text-style
      aria-label={t("masters.text_style_label")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !invalid && !empty) onEdit({ op: "master_set_text_style", part, placeholder, ...(idx !== undefined ? { idx } : {}), ...draft });
      }}
    >
      <span className="text-caption font-medium text-foreground">{t("masters.text_style_label")}</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={id + "-size"} className="text-caption text-muted-foreground">{t("masters.font_size")}</Label>
          <Input id={id + "-size"} inputMode="decimal" value={size} disabled={disabled} aria-invalid={sizePt === null || undefined} onChange={(event) => setSize(event.target.value)} className="h-8" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={id + "-color"} className="text-caption text-muted-foreground">{t("masters.font_color")}</Label>
          <Input id={id + "-color"} value={color} placeholder="#1F4E79" disabled={disabled} aria-invalid={hex === null || undefined} onChange={(event) => setColor(event.target.value)} className="h-8" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id + "-font"} className="text-caption text-muted-foreground">{t("masters.font_name")}</Label>
        <Input id={id + "-font"} value={font} disabled={disabled} onChange={(event) => setFont(event.target.value)} className="h-8" />
      </div>
      <div className="flex items-center gap-4">
        <Label className="flex items-center gap-2 text-caption text-foreground">
          <Checkbox checked={bold === true} disabled={disabled} onCheckedChange={(checked) => setBold(checked === true)} />
          {t("masters.bold")}
        </Label>
        <Label className="flex items-center gap-2 text-caption text-foreground">
          <Checkbox checked={italic === true} disabled={disabled} onCheckedChange={(checked) => setItalic(checked === true)} />
          {t("masters.italic")}
        </Label>
      </div>
      {invalid ? <p className="text-caption text-destructive" role="alert">{t("masters.text_style_invalid")}</p> : null}
      <Button type="submit" size="sm" variant="outline" disabled={disabled || invalid || empty} data-pptx-masters-text-style-apply>
        {t("masters.text_style_apply")}
      </Button>
    </form>
  );
}
