"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * "as of 12 seconds ago" for a panel that refreshes itself. An ops number
 * without its age is unreadable: the reader cannot tell a healthy zero from a
 * frozen one.
 */
export function UpdatedAt({ at }: { at: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.common" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  if (!at) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span aria-live="polite">
      {seconds < 60 ? t("updated_seconds", { n: seconds }) : t("updated_minutes", { n: Math.round(seconds / 60) })}
    </span>
  );
}
