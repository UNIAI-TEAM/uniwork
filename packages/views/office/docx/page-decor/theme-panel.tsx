"use client";

// B6 (UNI-924): theme panel. Presets apply a Word-like font pair + colour
// scheme together; the custom fields edit the major/minor/east-asian faces and
// the writeable colour-scheme slots one by one.
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  DOCX_THEME_COLOR_SLOTS,
  DOCX_THEME_PRESETS,
  type DocxPageDecorPanelProps,
} from "./docx-page-decor";

export function DocxThemePanel({ draft, readOnly, patch }: DocxPageDecorPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h3 className="text-body font-medium">{t("office.docx.pageDecor.theme.presets")}</h3>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {DOCX_THEME_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              className="h-auto justify-start gap-2 py-2"
              disabled={readOnly}
              onClick={() =>
                patch({
                  themeMajor: preset.fonts.major,
                  themeMinor: preset.fonts.minor,
                  themeEastAsia: preset.fonts.eastAsia ?? "",
                  themeColors: { ...preset.colors },
                })
              }
              data-testid={`docx-page-decor-theme-preset-${preset.key}`}
            >
              <span aria-hidden className="flex items-center gap-1">
                {(["accent1", "accent2", "accent3", "accent4"] as const).map((slot) => (
                  <span
                    key={slot}
                    className="size-3 rounded-full border border-border"
                    style={{ backgroundColor: `#${preset.colors[slot]}` }}
                  />
                ))}
              </span>
              {t(`office.docx.pageDecor.theme.presetNames.${preset.key}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-theme-major" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.theme.major")}
          </Label>
          <Input
            id="docx-page-decor-theme-major"
            value={draft.themeMajor}
            disabled={readOnly}
            onChange={(event) => patch({ themeMajor: event.target.value })}
            data-testid="docx-page-decor-theme-major"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-theme-minor" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.theme.minor")}
          </Label>
          <Input
            id="docx-page-decor-theme-minor"
            value={draft.themeMinor}
            disabled={readOnly}
            onChange={(event) => patch({ themeMinor: event.target.value })}
            data-testid="docx-page-decor-theme-minor"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="docx-page-decor-theme-eastasia" className="text-caption text-muted-foreground">
            {t("office.docx.pageDecor.theme.eastAsia")}
          </Label>
          <Input
            id="docx-page-decor-theme-eastasia"
            value={draft.themeEastAsia}
            disabled={readOnly}
            onChange={(event) => patch({ themeEastAsia: event.target.value })}
            data-testid="docx-page-decor-theme-eastasia"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <h3 className="text-body font-medium">{t("office.docx.pageDecor.theme.colors")}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DOCX_THEME_COLOR_SLOTS.map((slot) => (
            <div key={slot} className="grid gap-1">
              <Label htmlFor={`docx-page-decor-theme-color-${slot}`} className="text-caption text-muted-foreground">
                {t(`office.docx.pageDecor.theme.slots.${slot}`)}
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={`docx-page-decor-theme-color-${slot}`}
                  type="color"
                  className="w-10 shrink-0"
                  value={`#${draft.themeColors[slot]}`}
                  disabled={readOnly}
                  onChange={(event) => patch({ themeColors: { ...draft.themeColors, [slot]: event.target.value.replace(/^#/, "") } })}
                  data-testid={`docx-page-decor-theme-color-${slot}`}
                />
                <span className="text-caption text-muted-foreground">{draft.themeColors[slot]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
