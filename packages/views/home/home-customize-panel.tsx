"use client";

import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HOME_LAYOUTS, HOME_PRESETS, moveSection, type HomePrefs } from "@uniwork/core/home/prefs";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

const OPTION_CLASS = "h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left";

/**
 * Show or hide sections, move them up or down, pick a density or a preset.
 * Every change is saved at once; there is no apply step to forget.
 */
export function HomeCustomizePanel({
  prefs,
  saving,
  onChange,
  onReset,
  onClose,
}: {
  prefs: HomePrefs;
  saving: boolean;
  onChange: (next: HomePrefs) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section
      id="home-customize"
      aria-labelledby="home-customize-title"
      className="rounded-xl border border-surface-border bg-surface p-4 shadow-[var(--surface-shadow)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="home-customize-title" className="text-body font-semibold text-foreground">
            {t("home.customize.title")}
          </h2>
          <p className="mt-0.5 text-caption text-muted-foreground">{t("home.customize.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {saving ? (
            <span role="status" className="text-caption text-muted-foreground">
              {t("home.customize.saving")}
            </span>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden />
            {t("home.customize.reset")}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("home.customize.close")}>
            <X aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-caption font-medium text-muted-foreground">{t("home.customize.sections")}</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {prefs.order.map((key, idx) => {
              const label = t(`home.section.${key}`);
              return (
                <li key={key} className="flex items-center gap-3 px-3 py-2">
                  <Switch
                    checked={prefs.enabled[key]}
                    onCheckedChange={(value) => onChange({ ...prefs, enabled: { ...prefs.enabled, [key]: value } })}
                    aria-label={label}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-body", prefs.enabled[key] ? "text-foreground" : "text-muted-foreground")}>
                      {label}
                    </span>
                    <span className="block truncate text-caption text-muted-foreground">{t(`home.section.${key}_description`)}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={idx === 0}
                    onClick={() => onChange({ ...prefs, order: moveSection(prefs.order, key, -1) })}
                    aria-label={t("home.customize.move_up", { section: label })}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={idx === prefs.order.length - 1}
                    onClick={() => onChange({ ...prefs, order: moveSection(prefs.order, key, 1) })}
                    aria-label={t("home.customize.move_down", { section: label })}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-caption font-medium text-muted-foreground">{t("home.customize.layout")}</h3>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {HOME_LAYOUTS.map((layout) => (
                <Button
                  key={layout}
                  type="button"
                  variant={prefs.layout === layout ? "brandSubtle" : "outline"}
                  aria-pressed={prefs.layout === layout}
                  onClick={() => onChange({ ...prefs, layout })}
                  className={OPTION_CLASS}
                >
                  <span className="text-body font-medium">{t(`home.layout.${layout}`)}</span>
                  <span className="text-caption text-muted-foreground">{t(`home.layout.${layout}_hint`)}</span>
                </Button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-caption font-medium text-muted-foreground">{t("home.customize.presets")}</h3>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {HOME_PRESETS.map((preset) => (
                <Button key={preset.key} type="button" variant="outline" onClick={() => onChange(preset.prefs)} className={OPTION_CLASS}>
                  <span className="text-body font-medium">{t(`home.preset.${preset.key}`)}</span>
                  <span className="text-caption text-muted-foreground">{t(`home.preset.${preset.key}_description`)}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
