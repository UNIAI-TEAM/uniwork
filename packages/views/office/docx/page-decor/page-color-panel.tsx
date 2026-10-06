"use client";

// B6 (UNI-924): page-colour panel. Swatches write w:background through the
// set_page_color op; "No colour" removes it, and the custom field takes any
// hex the palette does not cover.
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { DOCX_PAGE_COLOR_PRESETS, normalizeHex, type DocxPageDecorPanelProps } from "./docx-page-decor";

export function DocxPageColorPanel({ draft, readOnly, patch }: DocxPageDecorPanelProps) {
  const { t } = useTranslation();
  const selected = draft.pageColor.trim().replace(/^#/, "").toUpperCase();
  // Swatch colours are document content, not UI chrome, so they are literal.
  const preview = normalizeHex(draft.pageColor) ?? "";
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h3 className="text-body font-medium">{t("office.docx.pageDecor.pageColor.palette")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={draft.pageColor.trim() === "" ? "default" : "outline"}
            size="sm"
            disabled={readOnly}
            onClick={() => patch({ pageColor: "" })}
            data-testid="docx-page-decor-color-none"
          >
            {t("office.docx.pageDecor.pageColor.none")}
          </Button>
          {DOCX_PAGE_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`size-7 rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${selected === preset.hex ? "ring-2 ring-ring" : ""}`}
              style={{ backgroundColor: `#${preset.hex}` }}
              aria-label={t(`office.docx.pageDecor.pageColor.paletteNames.${preset.key}`)}
              aria-pressed={selected === preset.hex}
              disabled={readOnly}
              onClick={() => patch({ pageColor: preset.hex })}
              data-testid={`docx-page-decor-color-${preset.key}`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="docx-page-decor-color-custom" className="text-caption text-muted-foreground">
          {t("office.docx.pageDecor.pageColor.custom")}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="docx-page-decor-color-custom"
            value={draft.pageColor}
            placeholder="FFF9E6"
            disabled={readOnly}
            aria-invalid={draft.pageColor.trim() !== "" && normalizeHex(draft.pageColor) === null ? true : undefined}
            onChange={(event) => patch({ pageColor: event.target.value })}
            data-testid="docx-page-decor-color-custom"
          />
          <span
            aria-hidden
            className="size-7 shrink-0 rounded-md border border-border"
            style={preview ? { backgroundColor: `#${preview}` } : undefined}
            data-testid="docx-page-decor-color-preview"
          />
        </div>
      </div>
    </div>
  );
}
