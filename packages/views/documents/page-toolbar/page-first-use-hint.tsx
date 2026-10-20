"use client";

import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { defaultStorage } from "@uniwork/core/platform";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";

export const PAGE_HINT_STORAGE_KEY = "uniwork.uninote.hint.dismissed.v1";

type HintStorage = Pick<StorageAdapter, "getItem" | "setItem">;

function wasDismissed(storage: HintStorage): boolean {
  try {
    return storage.getItem(PAGE_HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A one-time card for someone's first editable UniNote page; dismissal is remembered per browser profile. */
export function PageFirstUseHint({
  onShowShortcuts, onDismissed, storage = defaultStorage,
}: { onShowShortcuts: () => void; /** Called after a dismissal so focus can go back to the page instead of <body>. */ onDismissed?: () => void; storage?: HintStorage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !wasDismissed(storage));
  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    try {
      storage.setItem(PAGE_HINT_STORAGE_KEY, "1");
    } catch {
      // The hint simply returns next visit.
    }
    onDismissed?.();
  };
  return (
    <section
      aria-label={t("documents.page_ui.toolbar.hint.aria")}
      className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:p-4"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Lightbulb className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="text-body-lg font-semibold">{t("documents.page_ui.toolbar.hint.title")}</h2>
        <p className="text-body text-muted-foreground">
          <Trans t={t} i18nKey="documents.page_ui.toolbar.hint.body" components={{ kbd: <Kbd /> }} />
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button type="button" size="lg" onClick={dismiss}>{t("documents.page_ui.toolbar.hint.got_it")}</Button>
          <Button type="button" size="lg" variant="outline" onClick={onShowShortcuts}>
            {t("documents.page_ui.toolbar.hint.show_shortcuts")}
          </Button>
        </div>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.page_ui.toolbar.hint.close")} onClick={dismiss}>
        <X aria-hidden />
      </Button>
    </section>
  );
}
