import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";

/**
 * The row-menu download (and the viewer's fallback when no module frame can
 * host the file): one code path for both, named for the file. Extracted from
 * the page view so the view stays under the 500-line lint cap; the behavior
 * is unchanged.
 */
export function downloadSourceFile(args: {
  sourceId: string;
  fetchBlob: (sourceId: string) => Promise<Blob>;
  /** Filename lookup from the loaded rows; absent means an empty download name. */
  fileName: (sourceId: string) => string;
  failedCopy: string;
}): void {
  const { sourceId, fetchBlob, fileName, failedCopy } = args;
  void fetchBlob(sourceId).then(
    (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(sourceId);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    (error: unknown) => toast.error(apiErrorMessage(error) ?? failedCopy),
  );
}
