"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxSlideView } from "./slide-rail";

export interface PptxPresenterProps {
  slides: readonly PptxSlideView[];
  selectedIndex: number;
  open: boolean;
  onClose: () => void;
  className?: string;
}

/** Presentation mode is a view over the existing session. It receives the
 * current selection and has no editor handle, worker, or save path of its own. */
export function PptxPresenter({ slides, selectedIndex, open, onClose, className }: PptxPresenterProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  const slide = slides[selectedIndex];
  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col bg-black p-4 text-white", className)} role="dialog" aria-modal="true" aria-label={t("presenter_title")} data-pptx-presenter>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label">{t("presenter_title")}</span>
        <Button ref={closeRef} type="button" size="sm" variant="secondary" onClick={onClose}>{t("close_presenter")}</Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center py-4">
        {slide?.thumbnailUrl ? <img src={slide.thumbnailUrl} alt={slide.label ?? t("slide_number", { index: selectedIndex + 1 })} className="max-h-full max-w-full object-contain" /> : <div className="text-center text-2xl">{slide?.label ?? t("slide_number", { index: selectedIndex + 1 })}</div>}
      </div>
    </div>
  );
}

