"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { correlationIdOf } from "@uniwork/core/api";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";

/**
 * A monospace id with a copy button; a reader pastes it into the system log
 * search or a support message. The confirmation goes through a status region
 * that stays mounted, so a screen reader hears it: a swapped aria-label on the
 * focused button is not announced.
 */
export function CopyableId({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.correlation" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="text-caption break-all">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("copy", { label })}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("copied", { label }) : ""}
      </span>
    </span>
  );
}

/**
 * The line an error state adds when the failed request carried a correlation
 * id: the one string support needs to find the whole chain. Nothing when the
 * failure never reached the server (offline, a parse error).
 */
export function CorrelationNote({ error }: { error: unknown }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.correlation" });
  const id = correlationIdOf(error);
  if (!id) return null;
  return (
    <span className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <span>{t("hint")}</span>
      <CopyableId value={id} label={t("label")} />
    </span>
  );
}
