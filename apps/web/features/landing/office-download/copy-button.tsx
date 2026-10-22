"use client";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export type CopyState = "idle" | "copied" | "failed";

/** Writes to the clipboard and reports "copied" for two seconds; the caller decides where to say it. */
export function useCopy(value: string): { state: CopyState; copy: () => void } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(() => {
    const done = (next: CopyState) => { setState(next); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setState("idle"), 2200); };
    navigator.clipboard.writeText(value).then(() => done("copied"), () => done("failed"));
  }, [value]);
  return { state, copy };
}

/** The live region every copy control shares: "Đã sao chép" is announced, never only coloured. */
export function CopyStatus({ state }: { state: CopyState }) {
  const { t } = useTranslation();
  return <span className="sr-only" role="status">{state === "copied" ? t("office.desktop.install.copied") : state === "failed" ? t("office.desktop.install.copy_failed") : ""}</span>;
}

/** An icon button (with `label`) or, with `text`, a labelled one; both turn into a check once copied. */
export function CopyButton({ value, label, text, className }: { value: string; label: string; text?: string; className?: string }) {
  const { t } = useTranslation();
  const { state, copy } = useCopy(value);
  const Icon = state === "copied" ? Check : Copy;
  return <>
    <Button type="button" variant="ghost" size={text ? "sm" : "icon-sm"} className={cn("office-dl-copy", className)} data-copied={state === "copied" || undefined} aria-label={label} onClick={copy}>
      <Icon aria-hidden />{text && <span>{state === "copied" ? t("office.desktop.install.copied") : text}</span>}
    </Button>
    <CopyStatus state={state} />
  </>;
}
