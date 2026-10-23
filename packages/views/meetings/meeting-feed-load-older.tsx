"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/**
 * The line focus moves to when the button leaves with the last older page:
 * the first item of the feed it headed (its own `<li>`'s list, or the list
 * right after it).
 */
function feedList(button: HTMLElement): HTMLElement | null {
  const item = button.closest("li");
  if (item?.parentElement) return item.parentElement;
  const next = button.nextElementSibling;
  return next instanceof HTMLElement ? next : null;
}

/** The in-room feeds open on their newest page; this reads the page before it. */
export function MeetingFeedLoadOlder({
  label,
  loading,
  onLoad,
}: {
  label: string;
  loading: boolean;
  onLoad: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  // Set by a load the user started from the button; read when the button unmounts.
  const anchor = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      const list = anchor.current;
      const active = document.activeElement;
      // Focus went with the button (it fell to <body>): hand it to the oldest line loaded.
      if (!list?.isConnected || (active && active !== document.body)) return;
      const line = list.firstElementChild;
      if (!(line instanceof HTMLElement)) return;
      if (!line.hasAttribute("tabindex")) line.setAttribute("tabindex", "-1");
      line.focus();
    },
    [],
  );

  async function load() {
    if (loading) return;
    if (ref.current && ref.current === document.activeElement) anchor.current = feedList(ref.current);
    setFailed(false);
    try {
      await onLoad();
    } catch {
      setFailed(true);
    }
  }
  return (
    <>
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="ghost"
        className="w-full text-muted-foreground"
        aria-disabled={loading || undefined}
        aria-busy={loading || undefined}
        onClick={() => void load()}
      >
        {loading ? <Spinner data-icon="inline-start" /> : null}
        {label}
      </Button>
      {failed ? (
        <p role="alert" className="px-2 pb-1 text-center text-caption text-destructive">
          {t("meetings.loadOlderFailed")}
        </p>
      ) : null}
    </>
  );
}
