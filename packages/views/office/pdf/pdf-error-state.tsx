"use client";

import { FileExclamationPoint, LockKeyhole, ShieldAlert, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import { isOfficeTooLarge } from "@uniwork/core/office";
import { OfficeTooLargeNotice } from "../too-large-notice";
import type { PdfOpenFailure } from "./types";

const FAILURE_ICON = {
  corrupted: FileExclamationPoint,
  password_cancelled: LockKeyhole,
  password_required: LockKeyhole,
  wrong_password: LockKeyhole,
  engine_error: CircleAlert,
  unsupported_feature: ShieldAlert,
  not_office_file: FileExclamationPoint,
  io_error: CircleAlert,
  too_large: CircleAlert,
} as const;

function failureKey(failureClass: string): keyof typeof FAILURE_ICON | null {
  return failureClass in FAILURE_ICON ? (failureClass as keyof typeof FAILURE_ICON) : null;
}

export function PdfErrorState({ failure, onRetry }: { failure: PdfOpenFailure; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (isOfficeTooLarge(failure)) return <OfficeTooLargeNotice format="pdf" />;
  const Icon = FAILURE_ICON[failureKey(failure.failure_class) ?? "engine_error"] ?? CircleAlert;
  const reason = failure.message ?? t(`office.pdf.errors.${failure.failure_class}`, {
    defaultValue: t("office.pdf.errors.unknown"),
  });

  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="pdf-error-state">
      <Notice tone="destructive" icon={Icon} layout="inline" live="assertive" className="w-full max-w-xl">
        <div className="space-y-1">
          <p className="text-body font-semibold">{t("office.pdf.errors.title")}</p>
          <p>{reason}</p>
          {failure.engine_error ? <p className="font-mono text-caption text-destructive-soft-foreground">{failure.engine_error}</p> : null}
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">
              {t("office.pdf.actions.retryOpen")}
            </Button>
          ) : null}
        </div>
      </Notice>
    </section>
  );
}
