"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Kbd, KbdGroup } from "@uniwork/ui/components/ui/kbd";
import { Switch } from "@uniwork/ui/components/ui/switch";

const GROUPS: { titleKey: string; rows: { keys: string[]; labelKey: string }[] }[] = [
  {
    titleKey: "email_hub.shortcuts.group_list",
    rows: [
      { keys: ["C"], labelKey: "email_hub.shortcuts.compose" },
      { keys: ["/"], labelKey: "email_hub.shortcuts.search" },
      { keys: ["J", "K"], labelKey: "email_hub.shortcuts.move" },
      { keys: ["Enter"], labelKey: "email_hub.shortcuts.open" },
      { keys: ["?"], labelKey: "email_hub.shortcuts.help" },
    ],
  },
  {
    titleKey: "email_hub.shortcuts.group_reading",
    rows: [
      { keys: ["Esc", "U"], labelKey: "email_hub.shortcuts.back" },
      { keys: ["J", "K"], labelKey: "email_hub.shortcuts.step" },
      { keys: ["R"], labelKey: "email_hub.reply" },
      { keys: ["A"], labelKey: "email_hub.reply_all" },
      { keys: ["F"], labelKey: "email_hub.forward" },
      { keys: ["E"], labelKey: "email_hub.archive" },
      { keys: ["#"], labelKey: "email_hub.trash" },
      { keys: ["S"], labelKey: "email_hub.shortcuts.star" },
      { keys: ["Shift + U"], labelKey: "email_hub.bulk.mark_unread" },
    ],
  },
];

/**
 * Every Email Hub key in one place, and the switch that turns them off. Single
 * keys fire on a stray "e" from speech input (WCAG 2.1.4); the switch is the
 * way out, and it also stops "?" so nothing single-key is left listening.
 */
export function EmailHubShortcutsDialog({
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const switchId = useId();
  const hintId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" closeLabel={t("common.close")}>
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>{t("email_hub.shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("email_hub.shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <label htmlFor={switchId} className="text-body font-medium text-foreground">
              {t("email_hub.shortcuts.toggle")}
            </label>
            <p id={hintId} className="mt-0.5 text-caption text-pretty text-muted-foreground">
              {t("email_hub.shortcuts.toggle_hint")}
            </p>
          </div>
          <Switch
            id={switchId}
            checked={enabled}
            onCheckedChange={(value) => onEnabledChange(value === true)}
            aria-describedby={hintId}
          />
        </div>
        <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-5 py-4">
          {GROUPS.map((group) => (
            <section key={group.titleKey} aria-labelledby={`${switchId}-${group.titleKey}`}>
              <h3 id={`${switchId}-${group.titleKey}`} className="mb-2 text-overline text-muted-foreground">
                {t(group.titleKey)}
              </h3>
              <dl className="divide-y divide-border">
                {group.rows.map((row) => (
                  <div key={`${group.titleKey}-${row.labelKey}`} className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-body text-foreground">{t(row.labelKey)}</dt>
                    <dd>
                      <KbdGroup>
                        {row.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
