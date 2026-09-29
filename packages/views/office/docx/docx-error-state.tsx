"use client";

import { AlertTriangle, FileWarning, LockKeyhole, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import type { DocxOpenFailure } from "./types";

const FAILURE_ICON = {
  corrupted: FileWarning,
  password_cancelled: LockKeyhole,
  password_required: LockKeyhole,
  unsupported_feature: ShieldAlert,
  not_office_file: FileWarning,
} as const;

function failureKey(failureClass: string): keyof typeof FAILURE_ICON {
  return failureClass in FAILURE_ICON ? (failureClass as keyof typeof FAILURE_ICON) : "corrupted";
}

export function DocxErrorState({
  failure,
  onRetry,
}: {
  failure: DocxOpenFailure;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = FAILURE_ICON[failureKey(failure.failure_class)] ?? AlertTriangle;
  const reason = failure.message ?? t(`office.docx.errors.${failure.failure_class}`, {
    defaultValue: t("office.docx.errors.unknown"),
  });

  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="docx-error-state">
      <Notice tone="destructive" icon={Icon} layout="inline" live="assertive" className="w-full max-w-xl">
        <div className="space-y-1">
          <p className="text-body font-semibold">{t("office.docx.errors.title")}</p>
          <p>{reason}</p>
          <p className="text-caption text-destructive-soft-foreground/80">
            {t("office.docx.errors.reason", { reason: failure.failure_class })}
          </p>
          {failure.engine_error ? (
            <p className="font-mono text-caption text-destructive-soft-foreground/80">{failure.engine_error}</p>
          ) : null}
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">
              {t("office.docx.actions.retryOpen")}
            </Button>
          ) : null}
        </div>
      </Notice>
    </section>
  );
}
