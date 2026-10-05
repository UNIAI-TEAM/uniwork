"use client";

/**
 * A7 (UNI-927) - the keyboard-shortcuts help dialog.
 *
 * It lists exactly the bindings `PPTX_SHORTCUTS` holds, grouped and translated,
 * so the sheet can never drift from the handler. Keycaps come from the shared
 * `Kbd` primitive and the platform label from `getShortcutPlatform`, so a Mac
 * reads Cmd where Windows reads Ctrl.
 *
 * Labels are FULL i18next paths (`office.pptx.shortcuts.*`) translated at the
 * root, matching `PPTX_SHORTCUTS.labelKey`; a keyPrefix would double-prefix them.
 */
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Kbd, KbdGroup } from "@uniwork/ui/components/ui/kbd";
import { getShortcutPlatform } from "@uniwork/core/shortcuts";
import {
  PPTX_SHORTCUT_GROUPS,
  pptxShortcutKeys,
  pptxShortcutsForHelp,
  type PptxShortcutBinding,
} from "./pptx-shortcuts";

export interface PptxShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PptxShortcutsHelp({ open, onOpenChange }: PptxShortcutsHelpProps) {
  const { t } = useTranslation();
  const platform = getShortcutPlatform();
  const bindings = pptxShortcutsForHelp();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" closeLabel={t("office.pptx.shortcuts.close")} data-pptx-shortcuts-help>
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>{t("office.pptx.shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("office.pptx.shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-5 py-4">
          {PPTX_SHORTCUT_GROUPS.map((group) => {
            const rows: PptxShortcutBinding[] = bindings.filter((binding) => binding.group === group.id);
            if (rows.length === 0) return null;
            return (
              <section key={group.id} aria-label={t(group.labelKey)} data-pptx-shortcut-group={group.id}>
                <h3 className="mb-2 text-overline text-muted-foreground">{t(group.labelKey)}</h3>
                <dl className="divide-y divide-border">
                  {rows.map((binding) => (
                    <div key={binding.id} className="flex items-center justify-between gap-4 py-2">
                      <dt className="text-body text-foreground">{t(binding.labelKey)}</dt>
                      <dd>
                        <KbdGroup aria-label={t(binding.labelKey)}>
                          {pptxShortcutKeys(binding, platform).map((key, index) => (
                            <Kbd key={`${binding.id}-${index}`}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}