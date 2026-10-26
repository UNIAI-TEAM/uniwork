/** Legacy scroll-top gate — prefer {@link useChatOlderPrefetch} (IntersectionObserver). */
export function shouldPrefetchOlderHistoryAtScrollEdge(
  scrollEl: HTMLDivElement,
  stickToBottom: boolean,
  edgePx = 160,
): boolean {
  if (stickToBottom) return false;
  return scrollEl.scrollTop <= edgePx;
}
