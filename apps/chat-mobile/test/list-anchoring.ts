// How a rendered FlashList holds its scroll position, read from the host tree.
// FlashList 2 keeps the first visible row where it was across a data change
// unless maintainVisibleContentPosition is disabled: it hands the ScrollView
// that prop and renders an invisible ScrollAnchor (an absolute, zero-height
// view near y = 1,000,000) that it moves to scroll the list by a row's height.
// A list pinned to its top (the inbox, contacts) must have neither.
import { StyleSheet, type ViewStyle } from "react-native";

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | string)[] | null;
}

/** Above any real row's y in a test window: FlashList 2 seeds its anchor at 1,000,000. */
const ANCHOR_FLOOR = 999_000;

export interface ListAnchoring {
  /** The maintainVisibleContentPosition props handed to a scroll view (none when disabled). */
  maintained: unknown[];
  /** The y of each scroll anchor drawn. */
  anchors: number[];
}

export function listAnchoring(json: unknown): ListAnchoring {
  const found: ListAnchoring = { maintained: [], anchors: [] };
  const walk = (node: HostNode | string | null) => {
    if (node === null || typeof node === "string") return;
    if (node.props.maintainVisibleContentPosition !== undefined) found.maintained.push(node.props.maintainVisibleContentPosition);
    const style = StyleSheet.flatten(node.props.style as ViewStyle | undefined);
    if (style?.position === "absolute" && style.height === 0 && typeof style.top === "number" && style.top >= ANCHOR_FLOOR) found.anchors.push(style.top);
    node.children?.forEach(walk);
  };
  (Array.isArray(json) ? (json as HostNode[]) : [json as HostNode | null]).forEach(walk);
  return found;
}
