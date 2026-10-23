"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useTextSize } from "@uniwork/ui/hooks/use-text-size";
import { TEXT_SIZES, type TextSize } from "@uniwork/ui/lib/text-size";
import { cn } from "@uniwork/ui/lib/utils";
import { SettingsSection } from "./settings-layout";
import { FOCUS_FROM_RADIO } from "./themes-panel";

const LABEL_KEYS = {
  default: "textSizeDefault",
  large: "textSizeLarge",
  xlarge: "textSizeXLarge",
} as const satisfies Record<TextSize, string>;

/**
 * Text size, the accessibility setting beside the two theming axes: every
 * reading step of the type scale grows, layout and icons stay. Native radios
 * behind `sr-only`, as in `ThemesPanel`, so arrow keys and the checked state
 * come from the platform. Each sample carries its own `data-text-size`, so it
 * shows its level's size whatever the page is currently set to.
 */
export function TextSizePanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.preferences" });
  const { textSize, setTextSize } = useTextSize();
  const headingId = useId();

  return (
    <SettingsSection title={<span id={headingId}>{t("textSize")}</span>} description={t("textSizeHint")}>
      <fieldset aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {TEXT_SIZES.map((size) => (
          <label
            key={size}
            className={cn(
              "group flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg border border-border",
              "bg-surface py-1.5 pr-4 pl-2.5 transition-colors pointer-coarse:min-h-11",
              "hover:border-input",
              FOCUS_FROM_RADIO,
              "has-checked:border-brand has-checked:bg-surface-selected",
            )}
          >
            <input
              type="radio"
              name="uw-text-size"
              value={size}
              checked={textSize === size}
              onChange={() => setTextSize(size)}
              className="sr-only"
            />
            <span data-text-size={size} className="min-w-9 text-center text-title-sm font-semibold" aria-hidden>
              {t("textSizeSample")}
            </span>
            <span className="text-body font-medium">{t(LABEL_KEYS[size])}</span>
          </label>
        ))}
      </fieldset>
    </SettingsSection>
  );
}
