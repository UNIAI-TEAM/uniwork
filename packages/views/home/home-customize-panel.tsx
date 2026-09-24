"use client";

import { ArrowDown, ArrowUp, Check, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HOME_LAYOUTS, HOME_PRESETS, activePreset, moveSection, type HomePrefs } from "@uniwork/core/home/prefs";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

const OPTION_CLASS = "h-auto w-full justify-between gap-3 whitespace-normal px-3 py-2 text-left";

function OptionText({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="text-body font-medium">{title}</span>
      <span className="text-caption text-muted-foreground">{hint}</span>
    </span>
  );
}

/**
 * Show or hide sections, move them up or down, pick a density or a preset,
 * in a panel beside the page so the page itself stays where it was and every
 * change shows behind it. Every change is saved at once; there is no apply
 * step to forget. Reset is undoable from its toast (see HomeView).
 */
export function HomeCustomizePanel({
  open,
  prefs,
  saving,
  onChange,
  onReset,
  onClose,
}: {
  open: boolean;
  prefs: HomePrefs;
  saving: boolean;
  onChange: (next: HomePrefs) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preset = activePreset(prefs);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent id="home-customize" closeLabel={t("home.customize.close")} className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{t("home.customize.title")}</SheetTitle>
          <SheetDescription className="text-caption">{t("home.customize.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          <section aria-labelledby="home-customize-sections">
            <h3 id="home-customize-sections" className="text-label font-medium text-foreground">
              {t("home.customize.sections")}
            </h3>
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
                      <span className={cn("block text-body", prefs.enabled[key] ? "text-foreground" : "text-muted-foreground")}>
                        {label}
                      </span>
                      <span className="block text-caption text-pretty text-muted-foreground">{t(`home.section.${key}_description`)}</span>
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
          </section>

          <section aria-labelledby="home-customize-layout">
            <h3 id="home-customize-layout" className="text-label font-medium text-foreground">
              {t("home.customize.layout")}
            </h3>
            <div className="mt-2 grid gap-2">
              {HOME_LAYOUTS.map((layout) => {
                const current = prefs.layout === layout;
                return (
                  <Button
                    key={layout}
                    type="button"
                    variant={current ? "brandSubtle" : "outline"}
                    aria-pressed={current}
                    onClick={() => onChange({ ...prefs, layout })}
                    className={OPTION_CLASS}
                  >
                    <OptionText title={t(`home.layout.${layout}`)} hint={t(`home.layout.${layout}_hint`)} />
                    {current ? <Check aria-hidden className="shrink-0" /> : null}
                  </Button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="home-customize-presets">
            <h3 id="home-customize-presets" className="text-label font-medium text-foreground">
              {t("home.customize.presets")}
            </h3>
            <div className="mt-2 grid gap-2">
              {HOME_PRESETS.map(({ key, prefs: next }) => {
                const current = preset === key;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={current ? "brandSubtle" : "outline"}
                    aria-pressed={current}
                    onClick={() => onChange(next)}
                    className={OPTION_CLASS}
                  >
                    <OptionText title={t(`home.preset.${key}`)} hint={t(`home.preset.${key}_description`)} />
                    {current ? <Check aria-hidden className="shrink-0" /> : null}
                  </Button>
                );
              })}
            </div>
          </section>
        </div>

        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <span role="status" className="text-caption text-muted-foreground">
            {saving ? t("home.customize.saving") : null}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden />
            {t("home.customize.reset")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
