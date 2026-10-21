// Settings › Privacy & legal › Open-source licenses: every third-party
// package the app ships with (assets/licenses.json, scripts/
// generate-licenses.mjs), searchable by name or license; a row opens the
// package's npm page, where its license text and authors are.
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, View } from "react-native";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { filterLicenses, licenseEntries, type LicenseEntry } from "@/lib/licenses";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import rows from "@/assets/licenses.json";
import { useOpenWebPage } from "./use-open-web-page";

const ENTRIES = licenseEntries(rows);

function LicenseRow({ entry }: { entry: LicenseEntry }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const openWebPage = useOpenWebPage();
  const license = entry.license || t("mobile.licenses.unknown");
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${entry.name} ${entry.version}, ${license}`}
      accessibilityHint={t("mobile.licenses.open", { name: entry.name })}
      onPress={() => openWebPage(entry.url)}
      className="min-h-14 flex-row items-center gap-3 border-b-hairline border-border px-5 py-2 active:bg-secondary"
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-subhead font-semibold text-foreground">
          {entry.name}
        </Text>
        <Text numberOfLines={1} className="text-footnote text-muted-foreground">
          {`${entry.version} · ${license}`}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

export function LicensesList({ entries = ENTRIES }: { entries?: readonly LicenseEntry[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterLicenses(entries, query), [entries, query]);
  return (
    <FlatList
      data={shown}
      keyExtractor={(entry) => `${entry.name}@${entry.version}`}
      renderItem={({ item }) => <LicenseRow entry={item} />}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={20}
      ListHeaderComponent={
        <View className="gap-3 px-5 pb-3 pt-1">
          <Text className="text-subhead leading-[21px] text-muted-foreground">{t("mobile.licenses.intro", { count: entries.length })}</Text>
          <SearchField value={query} onChangeText={setQuery} placeholder={t("mobile.licenses.search")} accessibilityLabel={t("mobile.licenses.search")} className="h-10" />
        </View>
      }
      ListEmptyComponent={<Text className="px-5 py-6 text-center text-subhead text-muted-foreground">{t("mobile.licenses.empty")}</Text>}
      contentContainerClassName="pb-10"
    />
  );
}
