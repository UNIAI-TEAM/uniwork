"use client";

// B6 (UNI-924): watermark panel of the page-decoration dialog. The preset
// chips write the localized preset word as the watermark text, like Word's
// Design gallery.
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { DOCX_WATERMARK_PRESET_KEYS, type DocxPageDecorPanelProps } from "./docx-page-decor";

const OPACITY_CHOICES = [25, 50, 75, 100];

export function DocxWatermarkPanel({ draft, readOnly, patch }: DocxPageDecorPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <Label htmlFor="docx-page-decor-watermark-text" className="text-caption text-muted-foreground">
          {t("office.docx.pageDecor.watermark.text")}
        </Label>
        <Input
          id="docx-page-decor-watermark-text"
          value={draft.watermarkText}
          disabled={readOnly || draft.watermarkRemoved}
          onChange={(event) => patch({ watermarkText: event.target.value, watermarkRemoved: false })}
          data-testid="docx-page-decor-watermark-text"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DOCX_WATERMARK_PRESET_KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => patch({ watermarkText: t(`office.docx.pageDecor.watermark.presets.${key}`), watermarkRemoved: false })}
            data-testid={`docx-page-decor-watermark-preset-${key}`}
          >
            {t(`office.docx.pageDecor.watermark.presets.${key}`)}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={readOnly}
          onClick={() => patch({ watermarkText: "", watermarkRemoved: true })}
          data-testid="docx-page-decor-watermark-remove"
        >
          {t("office.docx.pageDecor.watermark.remove")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-watermark-font" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.watermark.font")}
          </Label>
          <Input
            id="docx-page-decor-watermark-font"
            value={draft.watermarkFont}
            disabled={readOnly}
            placeholder={t("office.docx.pageDecor.watermark.fontDefault")}
            onChange={(event) => patch({ watermarkFont: event.target.value })}
            data-testid="docx-page-decor-watermark-font"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-watermark-color" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.watermark.color")}
          </Label>
          <Input
            id="docx-page-decor-watermark-color"
            type="color"
            value={draft.watermarkColor === "" ? "#C0C0C0" : `#${draft.watermarkColor}`}
            disabled={readOnly}
            onChange={(event) => patch({ watermarkColor: event.target.value })}
            data-testid="docx-page-decor-watermark-color"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-watermark-opacity" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.watermark.opacity")}
          </Label>
          <Select
            id="docx-page-decor-watermark-opacity"
            value={draft.watermarkOpacity}
            disabled={readOnly}
            onValueChange={(value) => patch({ watermarkOpacity: value ?? "50" })}
            items={OPACITY_CHOICES.map((value) => ({
              value: String(value),
              label: t("office.docx.pageDecor.watermark.opacityValue", { value }),
            }))}
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Switch
            id="docx-page-decor-watermark-diagonal"
            checked={draft.watermarkDiagonal}
            disabled={readOnly}
            aria-label={t("office.docx.pageDecor.watermark.diagonal")}
            onCheckedChange={(checked) => patch({ watermarkDiagonal: checked })}
            data-testid="docx-page-decor-watermark-diagonal"
          />
          <Label htmlFor="docx-page-decor-watermark-diagonal" className="text-body">
            {t("office.docx.pageDecor.watermark.diagonal")}
          </Label>
        </div>
      </div>
    </div>
  );
}
