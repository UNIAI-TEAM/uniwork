import { useEffect } from "react";

/** The renderer's static `<title>` (renderer/index.html). */
const HOME_TITLE = "UniWork Office";

/** Name the window after the active document. The main process formats it as
 * "<document> - <product>" (main/branding.ts brandWindowTitle); the home tab
 * hands back the static title, which main shows as the product alone. */
export function useWindowTitle(documentTitle: string | undefined): void {
  useEffect(() => {
    document.title = documentTitle?.trim() || HOME_TITLE;
  }, [documentTitle]);
}
