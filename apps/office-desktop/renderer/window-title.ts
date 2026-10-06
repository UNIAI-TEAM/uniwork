import { useEffect } from "react";

/** Name the window after the active document. The main process formats it as
 * "<document> - <product>" (main/branding.ts brandWindowTitle); the home tab
 * leaves the title empty, which main shows as the product alone, so a
 * document named like the product keeps its name. */
export function useWindowTitle(documentTitle: string | undefined): void {
  useEffect(() => {
    document.title = documentTitle?.trim() ?? "";
  }, [documentTitle]);
}
