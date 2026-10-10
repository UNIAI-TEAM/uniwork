/**
 * While the Docs frame shows one of its own dialogs, its scrim covers only the
 * iframe. This dims the page around it and takes that chrome out of
 * interaction: every sibling of every ancestor of `keep`, up to the body,
 * becomes `inert` and dimmed, so the frame's dialog reads as modal for the
 * whole page (visual V1 #11). Elements that were already inert are left
 * alone. Returns the undo.
 */
export function dimChromeAround(keep: HTMLElement): () => void {
  const touched: { element: HTMLElement; filter: string; transition: string }[] = [];
  let node: HTMLElement | null = keep;
  while (node && node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert") || sibling.tagName === "SCRIPT") continue;
      touched.push({ element: sibling, filter: sibling.style.filter, transition: sibling.style.transition });
      sibling.setAttribute("inert", "");
      sibling.dataset.officeFrameModalDimmed = "";
      sibling.style.transition = "filter 150ms ease-out";
      sibling.style.filter = "brightness(0.6) saturate(0.8)";
    }
    node = node.parentElement;
  }
  return () => {
    for (const { element, filter, transition } of touched) {
      element.removeAttribute("inert");
      delete element.dataset.officeFrameModalDimmed;
      element.style.filter = filter;
      element.style.transition = transition;
    }
  };
}
