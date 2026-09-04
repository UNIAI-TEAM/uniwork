import { apiErrorMessage } from "@uniwork/core/api";
import { toast } from "sonner";

/** Show the backend error sentence in a toast, or a localized fallback. */
export function toastApiError(err: unknown, fallback: string): void {
  toast.error(apiErrorMessage(err) ?? fallback);
}
