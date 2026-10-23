import { ApiError, apiErrorMessage, errorCode, errorFields } from "@uniwork/core/api";
import { toast } from "sonner";

export type CreateTaskErrorToastCopy = {
  fallback: string;
  duplicateTitle: string;
  viewExisting: string;
  quotaExceeded: string;
  quotaContactAdmin: string;
  viewBilling: string;
  inFlight: string;
};

/**
 * Toast for create-task failures. Keeps the draft (caller must not clear it)
 * and offers a remediation action when the error carries enough fields.
 */
export function toastCreateTaskError(
  err: unknown,
  copy: CreateTaskErrorToastCopy,
  actions: {
    onViewTask?: (taskId: string) => void;
    onViewBilling?: () => void;
    canViewBilling?: boolean;
  } = {},
): void {
  const code = errorCode(err);
  if (code === "active_duplicate_task") {
    const fields = errorFields(err) ?? {};
    const taskId = typeof fields.task_id === "string" ? fields.task_id : "";
    const identifier = typeof fields.identifier === "string" ? fields.identifier : "";
    const title = typeof fields.title === "string" ? fields.title : "";
    const description = [identifier, title].filter(Boolean).join(" – ");
    toast.error(copy.duplicateTitle, {
      description: description || undefined,
      ...(taskId && actions.onViewTask
        ? {
            action: {
              label: copy.viewExisting,
              onClick: () => actions.onViewTask?.(taskId),
            },
          }
        : {}),
    });
    return;
  }
  if (code === "quota_exceeded") {
    toast.error(copy.quotaExceeded, {
      description: actions.canViewBilling ? undefined : copy.quotaContactAdmin,
      ...(actions.canViewBilling && actions.onViewBilling
        ? {
            action: {
              label: copy.viewBilling,
              onClick: () => actions.onViewBilling?.(),
            },
          }
        : {}),
    });
    return;
  }
  if (code === "idempotency_in_flight") {
    toast.error(copy.inFlight);
    return;
  }
  toast.error(apiErrorMessage(err) ?? (err instanceof ApiError ? err.message : copy.fallback));
}
