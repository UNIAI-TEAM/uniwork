/** Open a URL in a new tab / external handler. Desktop hosts can replace later. */
export function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}
