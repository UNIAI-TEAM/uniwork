"use client";

import { AlertTriangle, FileWarning, LockKeyhole, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "@uniwork/core/logger";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import type { XlsxOpenFailure } from "./types";

const logger = createLogger("xlsx-error-state");

const FAILURE_ICON = {
  corrupted: FileWarning,
  password_cancelled: LockKeyhole,
  password_required: LockKeyhole,
  unsupported_feature: ShieldAlert,
  not_office_file: FileWarning,
  engine_error: AlertTriangle,
} as const;

function failureKey(failureClass: string): keyof typeof FAILURE_ICON {
  return failureClass in FAILURE_ICON ? (failureClass as keyof typeof FAILURE_ICON) : "engine_error";
}

/**
 * E1 (UNI-926): the open-failure screen used to show only the friendly,
 * localized headline for every engine_error, so neither the reader nor a
 * tester could tell why a blocking open failed. The detail line keeps the
 * screen honest without leaking internals: one line only (no stack frames),
 * control characters and unbounded engine blobs are stripped.
 */
function sanitizeDetail(value: string | undefined): string | null {
  if (!value) return null;
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = Array.from(firstLine)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return null;
  return collapsed.length > 500 ? `${collapsed.slice(0, 500)}...` : collapsed;
}

export function XlsxErrorState({
  failure,
  onRetry,
}: {
  failure: XlsxOpenFailure;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const key = failureKey(failure.failure_class);
  const Icon = FAILURE_ICON[key];
  const reason = t(`office.xlsx.errors.${key}`);
  const detail = sanitizeDetail(failure.message);
  const code = sanitizeDetail(failure.engine_error);
  const hasDetail = detail !== null || code !== null;

  // An engine_error used to be logged nowhere: a developer saw only the
  // generic screen. Log the real class/message/code once per failure so the
  // console carries the cause the UI deliberately keeps out of the alert.
  useEffect(() => {
    if (key !== "engine_error") return;
    logger.error("xlsx open failed", {
      failure_class: failure.failure_class,
      message: failure.message ?? null,
      code: failure.engine_error ?? null,
    });
  }, [key, failure]);

  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="xlsx-error-state">
      <div className="w-full max-w-xl space-y-2">
        <Notice tone="destructive" icon={Icon} layout="inline" live="assertive" className="w-full">
          <div className="space-y-1">
            <h2 className="text-body font-semibold">{t("office.xlsx.errors.title")}</h2>
            <p>{reason}</p>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2 min-h-11">
                {t("office.xlsx.actions.retryOpen")}
              </Button>
            ) : null}
          </div>
        </Notice>
        {hasDetail ? (
          <details className="px-3 text-caption text-muted-foreground" data-testid="xlsx-error-details">
            <summary className="cursor-pointer select-none font-medium hover:text-foreground">
              {t("office.xlsx.errors.details")}
            </summary>
            <div className="mt-1 space-y-0.5">
              {detail ? <p className="break-words">{t("office.xlsx.errors.reason", { reason: detail })}</p> : null}
              <p className="break-words">{t("office.xlsx.errors.detailClass", { className: failure.failure_class })}</p>
              {code ? <p className="break-words font-mono">{t("office.xlsx.errors.detailCode", { code })}</p> : null}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}