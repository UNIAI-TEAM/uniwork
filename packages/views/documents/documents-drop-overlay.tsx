"use client";

import { useTranslation } from "react-i18next";

/**
 * The veil shown while files are dragged over the library. The label has its
 * own solid surface: on the bare semi-transparent veil it overlapped the card
 * titles beneath it (tester_visual r1 F1).
 */
export function DocumentsDropOverlay() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden
      data-testid="documents-drop-overlay"
      className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80"
    >
      <div
        data-testid="documents-drop-label"
        className="max-w-[calc(100%-2rem)] rounded-lg border border-border bg-popover px-4 py-2 text-center text-body font-medium text-popover-foreground shadow-[var(--floating-shadow)]"
      >
        {t("documents.home.drop_active")}
      </div>
    </div>
  );
}
