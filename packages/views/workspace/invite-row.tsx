"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export interface SentInvite {
  email: string;
  token: string;
}

/** Một dòng lời mời đã tạo: email + link + nút copy (Check xanh 2 s). */
export function InviteRow({ sent }: { sent: SentInvite }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${sent.token}`;
  return (
    <li className="flex items-center gap-3 rounded-[var(--uw-radius)] border border-line bg-surface px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-primary">{sent.email}</span>
        <span className="block truncate font-mono text-caption text-secondary">{link}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? t("common.copied") : t("common.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </li>
  );
}
