// The contacts tab's A–Z list (audit P1 Perf): a recycling FlashList over the
// sections flattened into header and person cells (lib/contacts-display.ts ›
// contactListItems), letter headers sticky, and the letters down the right
// edge (MobContacts board) jumping by index. A SectionList's scrollToLocation
// without getItemLayout throws when the letter's first row is past what has
// been measured (VirtualizedList's onScrollToIndexFailed invariant): a fatal
// error in any large workspace. FlashList scrolls to an index it has not
// measured by estimating, then corrects. A thousand people mount about one
// screenful of cells, reused as the list scrolls.
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { contactListItems, type ContactListItem, type ContactRow, type ContactSection } from "@/lib/contacts-display";
import { ContactItem } from "./contact-item";
import { LetterIndex } from "./letter-index";

interface Props {
  sections: readonly ContactSection[];
  onPress: (row: ContactRow) => void;
  /** The letters down the right edge: off while a search narrows the list. */
  showIndex: boolean;
  header: ReactElement | null;
  empty: ReactElement;
  refreshing: boolean;
  onRefresh: () => void;
}

const keyOf = (item: ContactListItem) => item.key;
const typeOf = (item: ContactListItem) => item.kind;
// FlashList 2 keeps the first visible row where it was across a data change unless this is disabled: a search that
// still matches the person on top would scroll every match above them out of view. The list starts at its first row.
const PINNED_TO_TOP = { disabled: true } as const;

export function ContactList({ sections, onPress, showIndex, header, empty, refreshing, onRefresh }: Props) {
  const list = useRef<FlashListRef<ContactListItem>>(null);
  const { items, headerIndices } = useMemo(() => contactListItems(sections), [sections]);
  const letters = useMemo(() => sections.map((section) => section.title), [sections]);
  const jump = useCallback(
    (sectionIndex: number) => {
      const index = headerIndices[sectionIndex];
      if (index !== undefined) void list.current?.scrollToIndex({ index, animated: true });
    },
    [headerIndices],
  );
  const renderItem: ListRenderItem<ContactListItem> = useCallback(
    ({ item }) =>
      item.kind === "header" ? (
        <Text accessibilityRole="header" className="bg-background px-4 py-1.5 text-footnote font-display font-bold text-muted-foreground">
          {item.title}
        </Text>
      ) : (
        <ContactItem row={item.row} onPress={onPress} separated={!item.last} />
      ),
    [onPress],
  );
  return (
    <View className="flex-1">
      <FlashList
        ref={list}
        data={items}
        keyExtractor={keyOf}
        getItemType={typeOf}
        renderItem={renderItem}
        stickyHeaderIndices={headerIndices}
        maintainVisibleContentPosition={PINNED_TO_TOP}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      {showIndex && letters.length > 1 ? <LetterIndex letters={letters} onJump={jump} /> : null}
    </View>
  );
}
