"use client";

// B6 (UNI-924): page-border panel. One box spec (style, width, colour, offset)
// is written to the section at the cursor through set_page_borders; the engine
// rewrites that section's w:pgBorders at save.
import { useTranslation } from "react-i18next";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { DOCX_BORDER_SPACE_CHOICES, DOCX_BORDER_STYLE_CHOICES, DOCX_BORDER_WIDTH_CHOICES, type DocxPageDecorPanelProps } from "./docx-page-decor";

export function DocxBordersPanel({ draft, readOnly, patch }: DocxPageDecorPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id="docx-page-decor-border-toggle"
          checked={draft.borderOn}
          disabled={readOnly}
          aria-label={t("office.docx.pageDecor.borders.box")}
          onCheckedChange={(checked) => patch({ borderOn: checked })}
          data-testid="docx-page-decor-border-toggle"
        />
        <Label htmlFor="docx-page-decor-border-toggle" className="text-body">
          {t("office.docx.pageDecor.borders.box")}
        </Label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-border-style" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.borders.style")}
          </Label>
          <Select
            id="docx-page-decor-border-style"
            value={draft.borderStyle}
            disabled={readOnly || !draft.borderOn}
            onValueChange={(value) => patch({ borderStyle: value ?? "single" })}
            items={DOCX_BORDER_STYLE_CHOICES.map((style) => ({
              value: style,
              label: t(`office.docx.pageDecor.borders.styles.${style}`),
            }))}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-border-width" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.borders.width")}
          </Label>
          <Select
            id="docx-page-decor-border-width"
            value={draft.borderWidth}
            disabled={readOnly || !draft.borderOn}
            onValueChange={(value) => patch({ borderWidth: value ?? "4" })}
            items={DOCX_BORDER_WIDTH_CHOICES.map((width) => ({
              value: String(width),
              label: t("office.docx.pageDecor.borders.widthValue", { pt: width / 8 }),
            }))}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-border-color" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.borders.color")}
          </Label>
          <Input
            id="docx-page-decor-border-color"
            type="color"
            value={draft.borderColor === "" ? "#000000" : `#${draft.borderColor}`}
            disabled={readOnly || !draft.borderOn}
            onChange={(event) => patch({ borderColor: event.target.value.replace(/^#/, "") })}
            data-testid="docx-page-decor-border-color"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-border-space" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.borders.space")}
          </Label>
          <Select
            id="docx-page-decor-border-space"
            value={draft.borderSpace}
            disabled={readOnly || !draft.borderOn}
            onValueChange={(value) => patch({ borderSpace: value ?? "24" })}
            items={DOCX_BORDER_SPACE_CHOICES.map((space) => ({
              value: String(space),
              label: t("office.docx.pageDecor.borders.spaceValue", { pt: space }),
            }))}
          />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="docx-page-decor-border-offset" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.borders.offset")}
          </Label>
          <Select
            id="docx-page-decor-border-offset"
            value={draft.borderOffset}
            disabled={readOnly || !draft.borderOn}
            onValueChange={(value) => patch({ borderOffset: value === "text" ? "text" : "page" })}
            items={[
              { value: "page", label: t("office.docx.pageDecor.borders.offsetPage") },
              { value: "text", label: t("office.docx.pageDecor.borders.offsetText") },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
