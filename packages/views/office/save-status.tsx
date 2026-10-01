"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeState, SaveCoordinatorState } from "@uniwork/core/office";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export type OfficeSaveStatusKind =
  | "checkpoint"
  | "saved-local"
  | "saved-cloud"
  | "not-sent"
  | "permission"
  | "conflict"
  | "saving"
  | "ready"
  | "error";

export interface SaveStatusProps {
  status?: OfficeSaveStatusKind | OfficeState;
  coordinatorState?: Pick<SaveCoordinatorState, "state" | "error"> | null;
  /** Where a confirmed save lands; a local file must not read as a cloud receipt. */
  destination?: "cloud" | "local";
  correlationId?: string | null;
  onAction?: () => void;
  className?: string;
}

const COORDINATOR_STATUS: Record<OfficeState, OfficeSaveStatusKind> = {
  dirty: "not-sent",
  ready: "saved-cloud",
  saving: "saving",
  saved: "saved-cloud",
  error: "error",
  conflict: "conflict",
  blocked: "permission",
  readonly: "permission",
  incompatible: "permission",
};

function normalizeStatus(status: SaveStatusProps["status"], coordinatorState: SaveStatusProps["coordinatorState"], destination: "cloud" | "local" = "cloud"): OfficeSaveStatusKind {
  let normalized: OfficeSaveStatusKind;
  if (status === "ready") normalized = "ready";
  else if (status && status in COORDINATOR_STATUS) normalized = COORDINATOR_STATUS[status as OfficeState];
  else if (status) normalized = status as OfficeSaveStatusKind;
  else if (coordinatorState?.state === "ready") normalized = "ready";
  else if (coordinatorState) normalized = COORDINATOR_STATUS[coordinatorState.state];
  // A host that has not supplied state must not claim a cloud receipt. Keep
  // the chrome neutral until the coordinator reports where the draft lives.
  else normalized = "ready";
  if (destination === "local" && normalized === "saved-cloud") return "saved-local";
  return normalized;
}

function actionKey(status: OfficeSaveStatusKind): string | null {
  switch (status) {
    case "checkpoint": return "checkpoint";
    case "saved-local": return "save_to_cloud";
    case "saved-cloud": return "done";
    case "not-sent": return "send";
    case "permission": return "keep_draft";
    case "conflict": return "review_conflict";
    case "error": return "retry";
    default: return null;
  }
}

/** Renders one shared status vocabulary for web and desktop. */
export function SaveStatus({
  status,
  coordinatorState,
  destination = "cloud",
  correlationId,
  onAction,
  className,
}: SaveStatusProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.save" });
  const normalized = normalizeStatus(status, coordinatorState, destination);
  const errorCorrelation = coordinatorState?.error?.correlationId ?? null;
  const resolvedCorrelation = correlationId ?? errorCorrelation;
  const action = actionKey(normalized);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (normalized === "permission" || normalized === "conflict" || normalized === "error") alertRef.current?.focus();
  }, [normalized]);

  const title = t(`status.${normalized}`);
  const body = t(`description.${normalized}`);
  const element = normalized === "permission" || normalized === "conflict" || normalized === "error" ? (
    <Alert
      ref={alertRef}
      tabIndex={-1}
      variant="destructive"
      className={cn("max-w-full", className)}
      data-testid={`office-save-${normalized}`}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {body}
        {resolvedCorrelation ? <span className="mt-1 block text-caption">{t("correlation", { id: resolvedCorrelation })}</span> : null}
      </AlertDescription>
      {action && onAction ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={onAction}>
          {t(`action.${action}`)}
        </Button>
      ) : null}
    </Alert>
  ) : (
    <div
      className={cn("flex min-h-8 items-center gap-2 text-caption text-muted-foreground", className)}
      role="status"
      aria-live="polite"
      data-testid={`office-save-${normalized}`}
    >
      <span>{title}</span>
      {resolvedCorrelation ? <span className="text-faint-foreground">{t("correlation", { id: resolvedCorrelation })}</span> : null}
      {action && onAction ? (
        <Button size="xs" variant="ghost" onClick={onAction}>
          {t(`action.${action}`)}
        </Button>
      ) : null}
    </div>
  );
  return element;
}
