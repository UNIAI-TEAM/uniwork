"use client";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { useOptionalNavigation } from "../navigation";

export interface SentInvite {
  email: string;
  token: string;
}

/** Một dòng lời mời đã tạo: email + link + nút copy (Check xanh 2 s). */
export function InviteRow({ sent }: { sent: SentInvite }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // The host knows the public origin; outside a provider (isolated mounts)
  // the relative path is still a correct link.
  const nav = useOptionalNavigation();
  const link = nav ? nav.getShareableUrl(paths.invite(sent.token)) : paths.invite(sent.token);
  const linkRef = useRef<HTMLSpanElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Copy, then Finish immediately, and this row unmounts before the timer fires.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  /** Select the link so the user can still Ctrl/Cmd+C when the clipboard API is unusable. */
  const selectLink = () => {
    const node = linkRef.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const copy = async () => {
    try {
      // `navigator.clipboard` does not exist outside a secure context — every
      // self-hosted install served over plain HTTP on a LAN lands here — and
      // `writeText` rejects separately when permission is denied. Both used to
      // be swallowed by `?.` and `void` while the button still flipped to the
      // check mark: the user believed the link was on their clipboard when it
      // had never been there. Automatic invite email does not exist yet (see
      // `step_invite.sent_hint`), so the hand-copied link IS the only way an
      // invitation reaches its recipient — a false success here silently costs
      // a teammate.
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
    } catch {
      selectLink();
      toast.error(t("workspace.copy_failed"));
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-foreground">{sent.email}</span>
        <span ref={linkRef} className="block truncate font-mono text-caption text-muted-foreground">
          {link}
        </span>
      </span>
      {/* Changing the `aria-label` of the button that currently HOLDS focus is
          not re-announced by screen readers, so the confirmation has to travel
          through a live region of its own — the same `role="status"` pattern
          StepFooter uses for its hint line. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t("workspace.copy_confirmed", { email: sent.email }) : ""}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? t("common.copied") : t("common.copy")}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </li>
  );
}
