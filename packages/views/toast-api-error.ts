import { toast } from "sonner";
import { apiErrorCopy } from "./api-error-copy";

/**
 * Show the error in a toast: our own wording for a code we know, else the
 * backend sentence, else a localized fallback.
 */
export function toastApiError(err: unknown, fallback: string): void {
  toast.error(apiErrorCopy(err) ?? fallback);
}
