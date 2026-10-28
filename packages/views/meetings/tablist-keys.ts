/**
 * WAI-ARIA tabs pattern, automatic activation: the index a key moves to in a
 * row of `count` tabs (arrows wrap, Home/End jump), or null for any other key.
 */
export function tablistKeyTarget(key: string, index: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return index === last ? 0 : index + 1;
    case "ArrowLeft":
      return index === 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
