"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
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
  /** Keep destructive status chrome compact when it is rendered in header actions. */
  compact?: boolean;
  /** One-line strip for a failed save instead of the card, so the editor below does not jump. */
  inline?: boolean;
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
  compact = false,
  inline = false,
}: SaveStatusProps) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "office.save" });
  const { t: tRoot } = useTranslation();
  const normalized = normalizeStatus(status, coordinatorState, destination);
  const errorCorrelation = coordinatorState?.error?.correlationId ?? null;
  const resolvedCorrelation = correlationId ?? errorCorrelation;
  // A refusal the coordinator marks non-retryable and that has written advice
  // (office.save.fix.<code>) gets no retry button; the body says what to do
  // instead. A non-retryable code without that copy keeps the generic banner.
  const errorCode = normalized === "error" ? coordinatorState?.error?.code : undefined;
  const unfixable = errorCode && coordinatorState?.error?.retryable === false && i18n.exists(`office.save.fix.${errorCode}`) ? errorCode : null;
  const action = unfixable ? null : actionKey(normalized);
  // F4 (UNI-926): a refused save used to show only the generic headline. The
  // coordinator keeps the job failure code/class in its error slot; surface it
  // so the reader (and a tester) can see why the save was not confirmed.
  const saveFailureReason = normalized === "error" && coordinatorState?.error
    // A code with a written explanation (office.save.reason.<code>) reads as
    // words; any other code reads as a generic sentence. The raw code stays in
    // data-error-code for a tester, never in the visible text.
    ? t(`reason.${coordinatorState.error.code}`, { defaultValue: t("reason.unknown") })
    : null;
  const errorCodeAttr = normalized === "error" ? coordinatorState?.error?.code : undefined;
  const alertRef = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    // The header chip never takes focus: it sits among header controls, and a programmatic focus drew a
    // stray focus ring around it (visual test H-01/MK-04). Its message is read through aria-describedby.
    if (!compact && (normalized === "permission" || normalized === "conflict" || normalized === "error")) alertRef.current?.focus();
  }, [normalized, compact]);

  const title = t(`status.${normalized}`);
  const body = unfixable ? t(`fix.${unfixable}`) : t(`description.${normalized}`);
  const destructive = normalized === "permission" || normalized === "conflict" || normalized === "error";
  const element = normalized === "error" && inline && !compact ? (
    <div
      ref={alertRef}
      tabIndex={-1}
      role="alert"
      aria-describedby={descriptionId}
      title={[body, saveFailureReason].filter(Boolean).join(" ")}
      className={cn("flex min-w-0 max-w-full items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-caption text-destructive", className)}
      data-testid="office-save-error"
      data-error-code={errorCodeAttr}
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="shrink-0 font-medium">{title}</span>
      <span id={descriptionId} className="min-w-0 truncate" data-testid="office-save-error-reason">
        {body}
        {saveFailureReason ? ` ${tRoot("office.xlsx.errors.saveReason", { reason: saveFailureReason })}` : ""}
        {resolvedCorrelation ? ` ${t("correlation", { id: resolvedCorrelation })}` : ""}
      </span>
      {action && onAction ? (
        <Button size="xs" variant="ghost" className="ml-auto shrink-0 text-destructive" onClick={onAction}>
          {t(`action.${action}`)}
        </Button>
      ) : null}
    </div>
  ) : destructive && compact ? (
    <div
      ref={alertRef}
      aria-describedby={descriptionId}
      title={body}
      className={cn("flex min-w-0 max-w-full items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-caption text-destructive", className)}
      data-testid={`office-save-${normalized}-compact`}
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
      <span id={descriptionId} className="sr-only">
        {body}
        {saveFailureReason ? ` ${tRoot("office.xlsx.errors.saveReason", { reason: saveFailureReason })}` : ""}
        {resolvedCorrelation ? ` ${t("correlation", { id: resolvedCorrelation })}` : ""}
      </span>
      {action && onAction ? (
        <Button size="xs" variant="ghost" className="shrink-0 text-destructive" onClick={onAction}>
          {t(`action.${action}`)}
        </Button>
      ) : null}
    </div>
  ) : destructive ? (
    <Alert
      ref={alertRef}
      tabIndex={-1}
      variant="destructive"
      className={cn("min-w-0 max-w-full break-words", className)}
      data-testid={`office-save-${normalized}`}
      data-error-code={errorCodeAttr}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {body}
        {saveFailureReason ? (
          <span className="mt-1 block break-words" data-testid="office-save-error-reason">
            {tRoot("office.xlsx.errors.saveReason", { reason: saveFailureReason })}
          </span>
        ) : null}
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
      title={compact ? title : undefined}
      data-testid={`office-save-${normalized}`}
    >
      {/* Header chrome reads the short form; the full one stays the tooltip. */}
      <span>{compact ? t(`short.${normalized}`) : title}</span>
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
