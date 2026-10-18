/**
 * The name an upload goes out under (UNI-1847): the same rules the server's
 * `files.SanitizeFilename` applies - only the base name survives, control
 * characters go, edge dots and spaces are trimmed, an unusable name is "file",
 * and the cap is 200 runes. Mirrors server/internal/files/filename.go so a
 * name built on the page (the first-save rename) lands the way the store
 * would have written it.
 */
export function sanitizeUploadFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "";
  const cleaned = [...base]
    .filter((r) => !/\p{Cc}/u.test(r))
    .join("")
    .replace(/^[. ]+|[. ]+$/g, "");
  const usable = cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
  return [...usable].length > 200 ? [...usable].slice(0, 200).join("") : usable;
}
