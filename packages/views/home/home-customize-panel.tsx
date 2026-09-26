"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  HOME_LAYOUTS,
  HOME_PRESETS,
  activePreset,
  moveSection,
  type HomePrefs,
  type HomeSectionKey,
} from "@uniwork/core/home/prefs";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

/** A radio drawn as a card: the native input keeps arrow keys and grouping, the label is the target. */
const OPTION_CLASS = cn(
  "group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2",
  "transition-colors duration-150 hover:border-input hover:bg-surface-hover pointer-coarse:min-h-11",
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
  "has-checked:border-brand has-checked:bg-brand-subtle",
);

function Option({
  name,
  checked,
  onSelect,
  title,
  hint,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label className={OPTION_CLASS}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="text-body font-medium text-foreground group-has-checked:text-brand-subtle-foreground">{title}</span>
        <span className="text-caption text-muted-foreground">{hint}</span>
      </span>
      <Check aria-hidden className="size-4 shrink-0 text-brand-subtle-foreground opacity-0 group-has-checked:opacity-100" />
    </label>
  );
}

type MoveTarget = { key: HomeSectionKey; dir: "up" | "down"; order: HomeSectionKey[] };

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
  const id = useId();
  const preset = activePreset(prefs);
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [refocus, setRefocus] = useState<MoveTarget | null>(null);

  // A section moved to either end disables the arrow that was just pressed;
  // focus then goes to the other arrow of the same row instead of the page.
  // Wait for the new order to render: the optimistic write lands a tick after
  // the click, and a row React moves in the DOM drops its focus.
  useLayoutEffect(() => {
    if (!refocus || refocus.order.join() !== prefs.order.join()) return;
    const button = buttons.current.get(`${refocus.key}:${refocus.dir}`);
    if (button && !button.disabled) button.focus();
    setRefocus(null);
  }, [prefs.order, refocus]);

  const move = (key: HomeSectionKey, dir: -1 | 1) => {
    const order = moveSection(prefs.order, key, dir);
    const at = order.indexOf(key);
    const atEnd = dir === -1 ? at === 0 : at === order.length - 1;
    setRefocus({ key, dir: atEnd ? (dir === -1 ? "down" : "up") : dir === -1 ? "up" : "down", order });
    onChange({ ...prefs, order });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent id="home-customize" closeLabel={t("home.customize.close")} className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{t("home.customize.title")}</SheetTitle>
          <SheetDescription className="text-caption">{t("home.customize.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          <section aria-labelledby={`${id}-sections`}>
            <h3 id={`${id}-sections`} className="text-label font-medium text-foreground">
              {t("home.customize.sections")}
            </h3>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {prefs.order.map((key, idx) => {
                const label = t(`home.section.${key}`);
                const hintId = `${id}-${key}-hint`;
                return (
                  <li key={key} className="flex items-center gap-3 px-3 py-2">
                    <Switch
                      checked={prefs.enabled[key]}
                      onCheckedChange={(value) => onChange({ ...prefs, enabled: { ...prefs.enabled, [key]: value } })}
                      aria-label={label}
                      aria-describedby={hintId}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-body", prefs.enabled[key] ? "text-foreground" : "text-muted-foreground")}>
                        {label}
                      </span>
                      <span id={hintId} className="block text-caption text-pretty text-muted-foreground">
                        {t(`home.section.${key}_description`)}
                      </span>
                    </span>
                    <Button
                      ref={(el) => void buttons.current.set(`${key}:up`, el)}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === 0}
                      onClick={() => move(key, -1)}
                      aria-label={t("home.customize.move_up", { section: label })}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      ref={(el) => void buttons.current.set(`${key}:down`, el)}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === prefs.order.length - 1}
                      onClick={() => move(key, 1)}
                      aria-label={t("home.customize.move_down", { section: label })}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>

          <fieldset>
            <legend className="text-label font-medium text-foreground">{t("home.customize.layout")}</legend>
            <div className="mt-2 grid gap-2">
              {HOME_LAYOUTS.map((layout) => (
                <Option
                  key={layout}
                  name={`${id}-layout`}
                  checked={prefs.layout === layout}
                  onSelect={() => onChange({ ...prefs, layout })}
                  title={t(`home.layout.${layout}`)}
                  hint={t(`home.layout.${layout}_hint`)}
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-label font-medium text-foreground">{t("home.customize.presets")}</legend>
            <div className="mt-2 grid gap-2">
              {HOME_PRESETS.map(({ key, prefs: next }) => (
                <Option
                  key={key}
                  name={`${id}-preset`}
                  checked={preset === key}
                  onSelect={() => onChange(next)}
                  title={t(`home.preset.${key}`)}
                  hint={t(`home.preset.${key}_description`)}
                />
              ))}
            </div>
          </fieldset>
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
