// The contacts list's sticky letter headers (contact-list.tsx › stickyHeaderIndices) run on FlashList 2.0.2's
// StickyHeaders, patched in patches/@shopify__flash-list@2.0.2.patch. Unpatched, it looked up a header's layout
// with getLayout, which throws "index out of bounds, not enough layouts" when the data has grown (members
// loaded, a search cleared) and the layout manager has not laid the new rows out yet: the workspace error
// boundary then replaced the contacts tab on an iPhone (Sentry UNICHAT-MOBILE-2, 0.3.0 (4) and 0.3.1 (5)).
import { createRef, type RefObject } from "react";
import { Animated, Text } from "react-native";
import { StickyHeaders, type StickyHeaderRef } from "@shopify/flash-list/dist/recyclerview/components/StickyHeaders";
import { act } from "@testing-library/react-native";
import { render } from "@/test/render";

/** A manager holding `laidOut` layouts of 40 px rows for `length` rows of data, as after a data change. */
function manager(length: number, laidOut: number) {
  const layout = (index: number) => ({ x: 0, y: index * 40, width: 320, height: 40 });
  return {
    getDataLength: () => length,
    getLastScrollOffset: () => 0,
    getEngagedIndices: () => ({ startIndex: 0, endIndex: laidOut - 1 }),
    firstItemOffset: 0,
    getLayout: (index: number) => {
      if (index >= laidOut) throw new Error("index out of bounds, not enough layouts");
      return layout(index);
    },
    tryGetLayout: (index: number) => (index >= 0 && index < laidOut ? layout(index) : undefined),
  };
}

const data = Array.from({ length: 12 }, (_, index) => `row ${index}`);

async function stickyHeaders(rv: ReturnType<typeof manager>) {
  const ref = createRef<StickyHeaderRef>();
  await render(
    <StickyHeaders
      stickyHeaderIndices={[0, 4, 9]}
      data={data}
      renderItem={({ item }: { item: string }) => <Text>{item}</Text>}
      scrollY={new Animated.Value(0)}
      stickyHeaderRef={ref as RefObject<StickyHeaderRef>}
      // StickyHeaders reads only these members of the RecyclerViewManager.
      recyclerViewManager={rv as never}
      extraData={undefined}
    />,
  );
  return ref;
}

describe("FlashList's sticky headers (patched)", () => {
  it("wait for the rows the data grew by to be laid out, instead of throwing", async () => {
    const ref = await stickyHeaders(manager(12, 3));
    await act(async () => ref.current?.reportScrollEvent({} as never));
  });

  it("still stick the first header once every row is laid out", async () => {
    const ref = await stickyHeaders(manager(12, 12));
    await act(async () => ref.current?.reportScrollEvent({} as never));
  });
});
