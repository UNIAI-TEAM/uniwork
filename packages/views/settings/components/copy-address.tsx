"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { SettingsCardBody } from "./settings-layout";

/**
 * The address and its copy button. The confirmation goes through a status
 * region that stays mounted so a screen reader hears it; a copy the browser
 * refuses says so, since the address on screen is then the only way out.
 */
export function CopyAddress({ value }: { value: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.connectedApps" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SettingsCardBody className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all text-caption">{value}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("copy")}
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } else {
            toast.error(i18n.t("settings.workspace.copy_failed"));
          }
        }}
      >
        {copied ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("copied") : ""}
      </span>
    </SettingsCardBody>
  );
}
