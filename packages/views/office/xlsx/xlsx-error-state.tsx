"use client";

import { AlertTriangle, FileWarning, LockKeyhole, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../../common/notice";
import type { XlsxOpenFailure } from "./types";

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

  return (
    <section className="flex min-h-64 flex-1 items-center justify-center p-6" data-testid="xlsx-error-state">
      <Notice tone="destructive" icon={Icon} layout="inline" live="assertive" className="w-full max-w-xl">
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
    </section>
  );
}
